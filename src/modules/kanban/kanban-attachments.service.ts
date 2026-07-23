import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { KanbanCardAttachmentStatus, KanbanCardStatus } from '@prisma/client';
import { PrismaService } from '../../core/database/prisma.service';
import { AuthenticatedUser } from '../../common/decorators/current-user.decorator';
import { KanbanAccessService } from './kanban-access.service';
import { VaultStorageService } from '../vault/vault-storage.service';
import {
  assertExtensionAllowed,
  assertSizeWithinCap,
} from '../vault/vault-guardrails';
import { KanbanActivityService } from './kanban-activity.service';
import {
  CreateAttachmentUploadUrlDto,
  ConfirmAttachmentDto,
} from './dto/kanban.dto';
import {
  KanbanAttachmentEntity,
  KanbanAttachmentUploadTicketEntity,
} from './entities/kanban.entity';

/**
 * Card file attachments. Bytes live in R2 (reusing VaultStorageService with a
 * card-scoped key — NOT the Vault folder/permission model), uploaded
 * browser→R2 via a presigned PUT in the same two-step discipline the Vault and
 * confirmation-sheet flows use: (1) create-upload-url writes a PENDING row +
 * presigns the PUT, (2) confirm head-checks the object landed and flips it
 * ACTIVE. Only ACTIVE rows are ever listed.
 */
@Injectable()
export class KanbanAttachmentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: KanbanAccessService,
    private readonly storage: VaultStorageService,
    private readonly activity: KanbanActivityService,
  ) {}

  private storageKeyFor(cardId: string, attachmentId: string): string {
    return `kanban/cards/${cardId}/attachments/${attachmentId}`;
  }

  /**
   * Step 1 — anyone with comment-level card access. Validates size, creates a PENDING attachment row
   * so we own the id (and therefore the storage key), then presigns the PUT.
   */
  async createUploadUrl(
    cardId: string,
    dto: CreateAttachmentUploadUrlDto,
    user: AuthenticatedUser,
  ): Promise<KanbanAttachmentUploadTicketEntity> {
    const card = await this.getCardOrThrow(cardId);
    await this.access.assertCanEditCard(user, card.boardId, card.assigneeId);
    assertExtensionAllowed(dto.filename);
    assertSizeWithinCap(dto.sizeBytes);

    const attachment = await this.prisma.kanbanCardAttachment.create({
      data: {
        cardId,
        filename: dto.filename,
        contentType: dto.contentType,
        sizeBytes: BigInt(dto.sizeBytes),
        storageKey: '', // set below once we have the id
        uploadedById: user.id,
        status: KanbanCardAttachmentStatus.PENDING,
      },
    });
    const storageKey = this.storageKeyFor(cardId, attachment.id);
    await this.prisma.kanbanCardAttachment.update({
      where: { id: attachment.id },
      data: { storageKey },
    });

    const { url, expiresInSeconds } = await this.storage.createUploadUrl(
      storageKey,
      dto.contentType || 'application/octet-stream',
    );
    return new KanbanAttachmentUploadTicketEntity({
      attachmentId: attachment.id,
      uploadUrl: url,
      expiresInSeconds,
    });
  }

  /**
   * Step 2 — verify the object actually landed in R2 (same head-check
   * discipline as Vault) before flipping the row to ACTIVE. A claimed-but-
   * absent upload never becomes visible.
   */
  async confirm(
    cardId: string,
    attachmentId: string,
    _dto: ConfirmAttachmentDto,
    user: AuthenticatedUser,
  ): Promise<KanbanAttachmentEntity> {
    const card = await this.getCardOrThrow(cardId);
    await this.access.assertCanEditCard(user, card.boardId, card.assigneeId);
    const attachment = await this.prisma.kanbanCardAttachment.findUnique({
      where: { id: attachmentId },
      include: { uploadedBy: { select: { firstName: true, lastName: true } } },
    });
    if (!attachment || attachment.cardId !== cardId) {
      throw new NotFoundException('Attachment not found');
    }
    // Confirm is idempotent. In particular, a client retry must not create a
    // duplicate activity entry for the same attachment.
    if (attachment.status === KanbanCardAttachmentStatus.ACTIVE) {
      return this.toEntity(attachment);
    }
    const head = await this.storage.headObject(attachment.storageKey);
    if (!head) {
      throw new BadRequestException(
        'No uploaded object found at the expected storage key — upload may not have completed',
      );
    }
    if (head.sizeBytes !== Number(attachment.sizeBytes)) {
      throw new BadRequestException(
        `Uploaded size (${head.sizeBytes}) does not match the declared size (${attachment.sizeBytes})`,
      );
    }
    const updated = await this.prisma.$transaction(async (tx) => {
      const active = await tx.kanbanCardAttachment.update({
        where: { id: attachmentId },
        data: { status: KanbanCardAttachmentStatus.ACTIVE },
        include: {
          uploadedBy: { select: { firstName: true, lastName: true } },
        },
      });
      await this.activity.log(
        tx,
        cardId,
        user.id,
        this.activity.attachmentAdded(active.filename),
      );
      return active;
    });
    return this.toEntity(updated);
  }

  /** ACTIVE attachments on a card — anyone with comment-level card access. */
  async list(
    cardId: string,
    user: AuthenticatedUser,
  ): Promise<KanbanAttachmentEntity[]> {
    const card = await this.getCardOrThrow(cardId);
    await this.access.assertCanViewCard(user, card.boardId, card.assigneeId);
    const rows = await this.prisma.kanbanCardAttachment.findMany({
      where: { cardId, status: KanbanCardAttachmentStatus.ACTIVE },
      include: { uploadedBy: { select: { firstName: true, lastName: true } } },
      orderBy: { createdAt: 'desc' },
    });
    return rows.map((r) => this.toEntity(r));
  }

  /** A short-lived presigned download URL — anyone with comment-level card access. */
  async downloadUrl(
    cardId: string,
    attachmentId: string,
    user: AuthenticatedUser,
  ): Promise<{ url: string; expiresInSeconds: number }> {
    const card = await this.getCardOrThrow(cardId);
    await this.access.assertCanViewCard(user, card.boardId, card.assigneeId);
    const attachment = await this.prisma.kanbanCardAttachment.findUnique({
      where: { id: attachmentId },
    });
    if (
      !attachment ||
      attachment.cardId !== cardId ||
      attachment.status !== KanbanCardAttachmentStatus.ACTIVE
    ) {
      throw new NotFoundException('Attachment not found');
    }
    return this.storage.createDownloadUrl(attachment.storageKey);
  }

  /**
   * Delete — any board member; for card-only assignees, their own uploads only.
   * Managing Scrum Masters/SUPER_ADMIN retain the comment-deletion override.
   */
  async remove(
    cardId: string,
    attachmentId: string,
    user: AuthenticatedUser,
  ): Promise<void> {
    const card = await this.getCardOrThrow(cardId);
    await this.access.assertCanEditCard(
      user,
      card.boardId,
      card.assigneeId,
    );
    const attachment = await this.prisma.kanbanCardAttachment.findUnique({
      where: { id: attachmentId },
    });
    if (!attachment || attachment.cardId !== cardId) {
      throw new NotFoundException('Attachment not found');
    }
    const isUploader = attachment.uploadedById === user.id;
    const canManage = await this.access
      .assertCanManageBoard(user, card.boardId)
      .then(() => true)
      .catch(() => false);
    if (!isUploader && !canManage) {
      throw new ForbiddenException(
        'Only the uploader or a Scrum Master/SUPER_ADMIN may delete this attachment',
      );
    }
    // A successful API response guarantees the bytes are gone. Delete R2
    // first and only then remove metadata; strict storage errors are surfaced.
    await this.storage.deleteObjectStrict(attachment.storageKey);
    await this.prisma.kanbanCardAttachment.delete({
      where: { id: attachmentId },
    });
  }

  // ── internals ──────────────────────────────────────────────────────

  private async getCardOrThrow(
    id: string,
  ): Promise<{ id: string; boardId: string; assigneeId: string | null }> {
    const card = await this.prisma.kanbanCard.findUnique({
      where: { id },
      select: {
        id: true,
        status: true,
        assigneeId: true,
        list: { select: { boardId: true } },
      },
    });
    if (!card || card.status === KanbanCardStatus.ARCHIVED) {
      throw new NotFoundException('Card not found');
    }
    return {
      id: card.id,
      boardId: card.list.boardId,
      assigneeId: card.assigneeId,
    };
  }

  private toEntity(a: {
    id: string;
    cardId: string;
    filename: string;
    contentType: string;
    sizeBytes: bigint;
    uploadedById: string;
    createdAt: Date;
    uploadedBy: { firstName: string; lastName: string } | null;
  }): KanbanAttachmentEntity {
    return new KanbanAttachmentEntity({
      id: a.id,
      cardId: a.cardId,
      filename: a.filename,
      contentType: a.contentType,
      sizeBytes: Number(a.sizeBytes),
      uploadedById: a.uploadedById,
      uploadedByName: a.uploadedBy
        ? `${a.uploadedBy.firstName} ${a.uploadedBy.lastName}`
        : null,
      createdAt: a.createdAt.toISOString(),
    });
  }
}
