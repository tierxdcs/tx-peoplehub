import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  BomEventType,
  BomStatus,
  NotificationType,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../../core/database/prisma.service';
import { AuthenticatedUser } from '../../common/decorators/current-user.decorator';
import { KanbanNotificationsService } from '../notifications/kanban-notifications.service';
import { BomAccessService } from './bom-access.service';
import { CreateBomDto, RejectBomDto, UpdateBomDto } from './dto/bom.dto';
import { BomEntity, BomEventEntity, BomLineEntity } from './entities/bom.entity';

const BOM_INCLUDE = {
  product: { select: { name: true, sku: true } },
  createdBy: { select: { firstName: true, lastName: true } },
  approvedBy: { select: { firstName: true, lastName: true } },
  lines: {
    orderBy: { sequence: 'asc' as const },
    include: { item: { select: { itemCode: true, name: true } } },
  },
} satisfies Prisma.BomInclude;

const BOM_INCLUDE_WITH_EVENTS = {
  ...BOM_INCLUDE,
  events: {
    orderBy: { createdAt: 'desc' as const },
    include: { actor: { select: { firstName: true, lastName: true } } },
  },
} satisfies Prisma.BomInclude;

type BomWithRelations = Prisma.BomGetPayload<{ include: typeof BOM_INCLUDE }> & {
  events?: Prisma.BomEventGetPayload<{
    include: { actor: { select: { firstName: true; lastName: true } } };
  }>[];
};

/**
 * Bill-of-Materials workflow. State machine:
 *   DRAFT → PENDING_APPROVAL → RELEASED (approve) | REJECTED (reject)
 *   REJECTED → PENDING_APPROVAL (resubmit after edit)
 *   RELEASED → OBSOLETE (when a newer revision is released)
 * Released revisions are immutable; editing one creates a fresh DRAFT revision.
 */
@Injectable()
export class BomService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: BomAccessService,
    private readonly notifications: KanbanNotificationsService,
  ) {}

  // ── Reads ────────────────────────────────────────────────────────────
  async list(
    user: AuthenticatedUser,
    opts: { productId?: string; status?: BomStatus } = {},
  ): Promise<BomEntity[]> {
    await this.access.assertCanReadBoms(user);
    const where: Prisma.BomWhereInput = {};
    if (opts.productId) where.productId = opts.productId;
    if (opts.status) where.status = opts.status;
    const rows = await this.prisma.bom.findMany({
      where,
      include: BOM_INCLUDE,
      orderBy: [{ createdAt: 'desc' }],
    });
    return rows.map((r) => this.toEntity(r));
  }

  async listForProduct(productId: string, user: AuthenticatedUser): Promise<BomEntity[]> {
    await this.access.assertCanReadBoms(user);
    const rows = await this.prisma.bom.findMany({
      where: { productId },
      include: BOM_INCLUDE,
      orderBy: { revisionNumber: 'desc' },
    });
    return rows.map((r) => this.toEntity(r));
  }

  async pendingApproval(user: AuthenticatedUser): Promise<BomEntity[]> {
    // Only R&D Heads (the approvers) should consume the queue.
    await this.access.assertCanApproveBoms(user);
    const rows = await this.prisma.bom.findMany({
      where: { status: BomStatus.PENDING_APPROVAL },
      include: BOM_INCLUDE,
      orderBy: { submittedAt: 'asc' },
    });
    return rows.map((r) => this.toEntity(r));
  }

  async get(id: string, user: AuthenticatedUser): Promise<BomEntity> {
    await this.access.assertCanReadBoms(user);
    const row = await this.prisma.bom.findUnique({
      where: { id },
      include: BOM_INCLUDE_WITH_EVENTS,
    });
    if (!row) throw new NotFoundException('BOM not found');
    return this.toEntity(row);
  }

  // ── Create / edit drafts ─────────────────────────────────────────────
  async create(dto: CreateBomDto, user: AuthenticatedUser): Promise<BomEntity> {
    await this.access.assertCanAuthorBoms(user);

    const product = await this.prisma.product.findUnique({
      where: { id: dto.productId },
      select: { id: true },
    });
    if (!product) throw new NotFoundException('Product not found');

    await this.assertItemsExist(dto.lines.map((l) => l.itemId));

    const nextRevision = await this.nextRevisionNumber(dto.productId);
    const created = await this.prisma.$transaction(async (tx) => {
      const bom = await tx.bom.create({
        data: {
          productId: dto.productId,
          revisionNumber: nextRevision,
          status: BomStatus.DRAFT,
          effectiveDate: dto.effectiveDate ? new Date(dto.effectiveDate) : null,
          revisionNotes: dto.revisionNotes ?? null,
          createdById: user.id,
          lines: { create: this.linesCreateData(dto.lines) },
        },
      });
      await tx.bomEvent.create({
        data: { bomId: bom.id, type: BomEventType.CREATED, actorId: user.id },
      });
      return bom;
    });
    return this.get(created.id, user);
  }

  async update(
    id: string,
    dto: UpdateBomDto,
    user: AuthenticatedUser,
  ): Promise<BomEntity> {
    await this.access.assertCanAuthorBoms(user);
    const bom = await this.prisma.bom.findUnique({ where: { id } });
    if (!bom) throw new NotFoundException('BOM not found');
    if (bom.status !== BomStatus.DRAFT && bom.status !== BomStatus.REJECTED) {
      throw new ForbiddenException(
        `A BOM in status ${bom.status} cannot be edited. Released BOMs are immutable — create a new revision instead.`,
      );
    }
    if (dto.lines) await this.assertItemsExist(dto.lines.map((l) => l.itemId));

    await this.prisma.$transaction(async (tx) => {
      const data: Prisma.BomUpdateInput = {};
      if (dto.effectiveDate !== undefined) {
        data.effectiveDate = dto.effectiveDate ? new Date(dto.effectiveDate) : null;
      }
      if (dto.revisionNotes !== undefined) data.revisionNotes = dto.revisionNotes;
      // A rejected BOM being edited returns to DRAFT until resubmitted.
      if (bom.status === BomStatus.REJECTED) data.status = BomStatus.DRAFT;

      if (dto.lines) {
        data.lines = {
          deleteMany: {},
          create: this.linesCreateData(dto.lines),
        };
      }
      await tx.bom.update({ where: { id }, data });
      await tx.bomEvent.create({
        data: { bomId: id, type: BomEventType.UPDATED, actorId: user.id },
      });
    });
    return this.get(id, user);
  }

  // ── Workflow transitions ─────────────────────────────────────────────
  async submit(id: string, user: AuthenticatedUser): Promise<BomEntity> {
    await this.access.assertCanAuthorBoms(user);
    const bom = await this.prisma.bom.findUnique({
      where: { id },
      include: { lines: { select: { id: true } } },
    });
    if (!bom) throw new NotFoundException('BOM not found');
    if (bom.status !== BomStatus.DRAFT && bom.status !== BomStatus.REJECTED) {
      throw new BadRequestException(
        `Only a DRAFT or REJECTED BOM can be submitted (current: ${bom.status})`,
      );
    }
    if (bom.lines.length === 0) {
      throw new BadRequestException('Cannot submit a BOM with no lines');
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.bom.update({
        where: { id },
        data: {
          status: BomStatus.PENDING_APPROVAL,
          submittedById: user.id,
          submittedAt: new Date(),
          // clear any prior rejection so the record reads cleanly on resubmit
          rejectedById: null,
          rejectedAt: null,
          rejectionComment: null,
        },
      });
      await tx.bomEvent.create({
        data: { bomId: id, type: BomEventType.SUBMITTED, actorId: user.id },
      });
    });

    // Notify every R&D Head (the approver pool), after commit.
    const heads = await this.prisma.employee.findMany({
      where: { isRdHead: true, status: 'ACTIVE' },
      select: { id: true },
    });
    const product = await this.prisma.product.findUnique({
      where: { id: bom.productId },
      select: { name: true },
    });
    for (const head of heads) {
      await this.notifications.notifyBomWorkflow({
        recipientId: head.id,
        actorId: user.id,
        type: NotificationType.BOM_SUBMITTED,
        bomId: id,
        message: `BOM Rev ${bom.revisionNumber} for ${product?.name ?? 'a product'} was submitted for approval`,
      });
    }
    return this.get(id, user);
  }

  async approve(id: string, user: AuthenticatedUser): Promise<BomEntity> {
    await this.access.assertCanApproveBoms(user);
    const bom = await this.prisma.bom.findUnique({ where: { id } });
    if (!bom) throw new NotFoundException('BOM not found');
    if (bom.status !== BomStatus.PENDING_APPROVAL) {
      throw new BadRequestException(
        `Only a PENDING_APPROVAL BOM can be approved (current: ${bom.status})`,
      );
    }
    // An R&D Head must not approve a BOM they created (§4).
    if (bom.createdById === user.id) {
      throw new ForbiddenException(
        'An R&D Head cannot approve a BOM they created — another R&D Head must approve it',
      );
    }

    const signer = await this.prisma.employee.findUnique({
      where: { id: user.id },
      select: { signatureText: true, signatureFont: true },
    });

    // Release this revision and obsolete the previously-released one, atomically.
    await this.prisma.$transaction(async (tx) => {
      // Capture which revisions we're about to supersede BEFORE mutating them,
      // so the event trail records exactly this transaction's obsoletions.
      const superseded = await tx.bom.findMany({
        where: {
          productId: bom.productId,
          status: BomStatus.RELEASED,
          id: { not: id },
        },
        select: { id: true },
      });
      await tx.bom.updateMany({
        where: {
          productId: bom.productId,
          status: BomStatus.RELEASED,
          id: { not: id },
        },
        data: { status: BomStatus.OBSOLETE },
      });
      await tx.bom.update({
        where: { id },
        data: {
          status: BomStatus.RELEASED,
          approvedById: user.id,
          approvedAt: new Date(),
          approverSignatureTextSnapshot: signer?.signatureText ?? null,
          approverSignatureFontSnapshot: signer?.signatureFont ?? null,
          effectiveDate: bom.effectiveDate ?? new Date(),
        },
      });
      await tx.bomEvent.create({
        data: { bomId: id, type: BomEventType.APPROVED, actorId: user.id },
      });
      await tx.bomEvent.create({
        data: { bomId: id, type: BomEventType.RELEASED, actorId: user.id },
      });
      // The superseded set was computed AFTER updateMany, so it includes rows
      // just obsoleted in this txn — record an event on each for the trail.
      for (const s of superseded) {
        await tx.bomEvent.create({
          data: { bomId: s.id, type: BomEventType.OBSOLETED, actorId: user.id },
        });
      }
    });

    await this.notifications.notifyBomWorkflow({
      recipientId: bom.createdById,
      actorId: user.id,
      type: NotificationType.BOM_APPROVED,
      bomId: id,
      message: `Your BOM Rev ${bom.revisionNumber} was approved and released`,
    });
    return this.get(id, user);
  }

  async reject(
    id: string,
    dto: RejectBomDto,
    user: AuthenticatedUser,
  ): Promise<BomEntity> {
    await this.access.assertCanApproveBoms(user);
    if (!dto.comment || !dto.comment.trim()) {
      throw new BadRequestException('A rejection comment is required');
    }
    const bom = await this.prisma.bom.findUnique({ where: { id } });
    if (!bom) throw new NotFoundException('BOM not found');
    if (bom.status !== BomStatus.PENDING_APPROVAL) {
      throw new BadRequestException(
        `Only a PENDING_APPROVAL BOM can be rejected (current: ${bom.status})`,
      );
    }
    if (bom.createdById === user.id) {
      throw new ForbiddenException(
        'An R&D Head cannot review a BOM they created — another R&D Head must review it',
      );
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.bom.update({
        where: { id },
        data: {
          status: BomStatus.REJECTED,
          rejectedById: user.id,
          rejectedAt: new Date(),
          rejectionComment: dto.comment.trim(),
        },
      });
      await tx.bomEvent.create({
        data: {
          bomId: id,
          type: BomEventType.REJECTED,
          actorId: user.id,
          comment: dto.comment.trim(),
        },
      });
    });

    await this.notifications.notifyBomWorkflow({
      recipientId: bom.createdById,
      actorId: user.id,
      type: NotificationType.BOM_REJECTED,
      bomId: id,
      message: `Your BOM Rev ${bom.revisionNumber} was rejected: ${dto.comment.trim()}`,
    });
    return this.get(id, user);
  }

  /**
   * Create a fresh DRAFT revision seeded from an existing (typically RELEASED)
   * revision's lines. This is how a released BOM is "edited" — the released
   * data is never mutated.
   */
  async newRevision(id: string, user: AuthenticatedUser): Promise<BomEntity> {
    await this.access.assertCanAuthorBoms(user);
    const source = await this.prisma.bom.findUnique({
      where: { id },
      include: { lines: { orderBy: { sequence: 'asc' } } },
    });
    if (!source) throw new NotFoundException('BOM not found');

    const nextRevision = await this.nextRevisionNumber(source.productId);
    const created = await this.prisma.$transaction(async (tx) => {
      const bom = await tx.bom.create({
        data: {
          productId: source.productId,
          revisionNumber: nextRevision,
          status: BomStatus.DRAFT,
          revisionNotes: source.revisionNotes,
          createdById: user.id,
          lines: {
            create: source.lines.map((l) => ({
              itemId: l.itemId,
              quantityPerUnit: l.quantityPerUnit,
              unitOfMeasure: l.unitOfMeasure,
              wastagePercent: l.wastagePercent,
              makeBuy: l.makeBuy,
              notes: l.notes,
              drawingSpecReference: l.drawingSpecReference,
              sequence: l.sequence,
            })),
          },
        },
      });
      await tx.bomEvent.create({
        data: {
          bomId: bom.id,
          type: BomEventType.REVISION_CREATED,
          actorId: user.id,
          comment: `Seeded from Rev ${source.revisionNumber}`,
        },
      });
      return bom;
    });
    return this.get(created.id, user);
  }

  // ── Helpers ──────────────────────────────────────────────────────────
  private async nextRevisionNumber(productId: string): Promise<number> {
    const latest = await this.prisma.bom.findFirst({
      where: { productId },
      orderBy: { revisionNumber: 'desc' },
      select: { revisionNumber: true },
    });
    return (latest?.revisionNumber ?? 0) + 1;
  }

  private async assertItemsExist(itemIds: string[]): Promise<void> {
    const unique = [...new Set(itemIds)];
    if (unique.length === 0) return;
    const found = await this.prisma.item.findMany({
      where: { id: { in: unique } },
      select: { id: true, isActive: true },
    });
    if (found.length !== unique.length) {
      throw new BadRequestException('One or more BOM lines reference an unknown item');
    }
    const inactive = found.filter((f) => !f.isActive);
    if (inactive.length > 0) {
      throw new BadRequestException(
        'One or more BOM lines reference an inactive item',
      );
    }
  }

  private linesCreateData(
    lines: CreateBomDto['lines'],
  ): Prisma.BomLineUncheckedCreateWithoutBomInput[] {
    return lines.map((l, i) => ({
      itemId: l.itemId,
      quantityPerUnit: new Prisma.Decimal(l.quantityPerUnit),
      unitOfMeasure: l.unitOfMeasure,
      wastagePercent: new Prisma.Decimal(l.wastagePercent ?? 0),
      makeBuy: l.makeBuy ?? 'BUY',
      notes: l.notes ?? null,
      drawingSpecReference: l.drawingSpecReference ?? null,
      sequence: l.sequence ?? i,
    }));
  }

  private toEntity(b: BomWithRelations): BomEntity {
    const name = (e?: { firstName: string; lastName: string } | null) =>
      e ? `${e.firstName} ${e.lastName}`.trim() : null;
    return new BomEntity({
      id: b.id,
      productId: b.productId,
      productName: b.product?.name ?? null,
      productSku: b.product?.sku ?? null,
      revisionNumber: b.revisionNumber,
      status: b.status,
      effectiveDate: b.effectiveDate ? b.effectiveDate.toISOString() : null,
      revisionNotes: b.revisionNotes,
      createdById: b.createdById,
      createdByName: name(b.createdBy),
      submittedById: b.submittedById,
      submittedAt: b.submittedAt ? b.submittedAt.toISOString() : null,
      approvedById: b.approvedById,
      approvedByName: name(b.approvedBy),
      approvedAt: b.approvedAt ? b.approvedAt.toISOString() : null,
      rejectedById: b.rejectedById,
      rejectedAt: b.rejectedAt ? b.rejectedAt.toISOString() : null,
      rejectionComment: b.rejectionComment,
      approverSignatureTextSnapshot: b.approverSignatureTextSnapshot,
      approverSignatureFontSnapshot: b.approverSignatureFontSnapshot,
      lines: b.lines.map(
        (l) =>
          new BomLineEntity({
            id: l.id,
            itemId: l.itemId,
            itemCode: l.item.itemCode,
            itemName: l.item.name,
            quantityPerUnit: l.quantityPerUnit.toString(),
            unitOfMeasure: l.unitOfMeasure,
            wastagePercent: l.wastagePercent.toString(),
            makeBuy: l.makeBuy,
            notes: l.notes,
            drawingSpecReference: l.drawingSpecReference,
            sequence: l.sequence,
          }),
      ),
      events: b.events?.map(
        (e) =>
          new BomEventEntity({
            id: e.id,
            type: e.type,
            actorId: e.actorId,
            actorName: name(e.actor),
            comment: e.comment,
            createdAt: e.createdAt.toISOString(),
          }),
      ),
      createdAt: b.createdAt.toISOString(),
      updatedAt: b.updatedAt.toISOString(),
    });
  }
}
