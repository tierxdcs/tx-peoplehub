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
  CreateAttachmentUploadUrlDto,
  ConfirmAttachmentDto,
} from './dto/kanban.dto';
import {
  KanbanAttachmentEntity,
  KanbanAttachmentUploadTicketEntity,
} from './entities/kanban.entity';

/** 25 MB — a sensible cap so card attachments don't become bulk file storage. */
const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024;

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
  ) {}

  private storageKeyFor(cardId: string, attachmentId: string): string {
    return `kanban/cards/${cardId}/attachments/${attachmentId}`;
  }

  /**
   * Step 1 — any board member. Validates size, creates a PENDING attachment row
   * so we own the id (and therefore the storage key), then presigns the PUT.
   */
  async createUploadUrl(
    cardId: string,
    dto: CreateAttachmentUploadUrlDto,
    user: AuthenticatedUser,
  ): Promise<KanbanAttachmentUploadTicketEntity> {
    const card = await this.getCardOrThrow(cardId);
    await this.access.assertCanViewBoard(user, card.boardId);

    if (dto.sizeBytes > MAX_ATTACHMENT_BYTES) {
      throw new BadRequestException(
        `File is too large (max ${Math.floor(MAX_ATTACHMENT_BYTES / (1024 * 1024))} MB)`,
      );
    }

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
    await this.access.assertCanViewBoard(user, card.boardId);
    const attachment = await this.prisma.kanbanCardAttachment.findUnique({
      where: { id: attachmentId },
      include: { uploadedBy: { select: { firstName: true, lastName: true } } },
    });
    if (!attachment || attachment.cardId !== cardId) {
      throw new NotFoundException('Attachment not found');
    }
    const head = await this.storage.headObject(attachment.storageKey);
    if (!head) {
      throw new BadRequestException(
        'No uploaded object found — the upload may not have completed',
      );
    }
    const updated = await this.prisma.kanbanCardAttachment.update({
      where: { id: attachmentId },
      data: { status: KanbanCardAttachmentStatus.ACTIVE },
      include: { uploadedBy: { select: { firstName: true, lastName: true } } },
    });
    return this.toEntity(updated);
  }

  /** ACTIVE attachments on a card — any board member. */
  async list(
    cardId: string,
    user: AuthenticatedUser,
  ): Promise<KanbanAttachmentEntity[]> {
    const card = await this.getCardOrThrow(cardId);
    await this.access.assertCanViewBoard(user, card.boardId);
    const rows = await this.prisma.kanbanCardAttachment.findMany({
      where: { cardId, status: KanbanCardAttachmentStatus.ACTIVE },
      include: { uploadedBy: { select: { firstName: true, lastName: true } } },
      orderBy: { createdAt: 'desc' },
    });
    return rows.map((r) => this.toEntity(r));
  }

  /** A short-lived presigned download URL — any board member. */
  async downloadUrl(
    cardId: string,
    attachmentId: string,
    user: AuthenticatedUser,
  ): Promise<{ url: string; expiresInSeconds: number }> {
    const card = await this.getCardOrThrow(cardId);
    await this.access.assertCanViewBoard(user, card.boardId);
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
   * Delete — the UPLOADER, or a Scrum Master/SUPER_ADMIN who manages the board
   * (same override as comment deletion). Best-effort R2 object removal.
   */
  async remove(
    cardId: string,
    attachmentId: string,
    user: AuthenticatedUser,
  ): Promise<void> {
    const card = await this.getCardOrThrow(cardId);
    await this.access.assertCanViewBoard(user, card.boardId);
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
    await this.prisma.kanbanCardAttachment.delete({ where: { id: attachmentId } });
    // Best-effort: free the R2 object. Never throws (mirrors Vault delete).
    await this.storage.deleteObject(attachment.storageKey);
  }

  // ── internals ──────────────────────────────────────────────────────

  private async getCardOrThrow(
    id: string,
  ): Promise<{ id: string; boardId: string }> {
    const card = await this.prisma.kanbanCard.findUnique({
      where: { id },
      select: { id: true, status: true, list: { select: { boardId: true } } },
    });
    if (!card || card.status === KanbanCardStatus.ARCHIVED) {
      throw new NotFoundException('Card not found');
    }
    return { id: card.id, boardId: card.list.boardId };
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
