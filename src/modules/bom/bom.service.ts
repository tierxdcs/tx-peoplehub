import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  BomEventType,
  BomStatus,
  ItemType,
  NotificationType,
  Prisma,
  SupplierStatus,
} from '@prisma/client';
import { PrismaService } from '../../core/database/prisma.service';
import { AuthenticatedUser } from '../../common/decorators/current-user.decorator';
import { KanbanNotificationsService } from '../notifications/kanban-notifications.service';
import { BomAccessService } from './bom-access.service';
import {
  CreateBomDto,
  LinkSupplierDto,
  RejectBomDto,
  UpdateBomDto,
} from './dto/bom.dto';
import {
  BomEntity,
  BomEventEntity,
  BomLineEntity,
  ItemSupplierEntity,
} from './entities/bom.entity';
import {
  BomCycleError,
  BomDepthError,
  ExplodableBom,
  explodeBom,
} from './bom-explosion';

/** Supplier statuses that qualify a supplier link for the release hard-gate. */
const QUALIFIED_SUPPLIER_STATUSES: SupplierStatus[] = [
  SupplierStatus.APPROVED,
  SupplierStatus.APPROVED_PREFERRED,
];

const BOM_INCLUDE = {
  item: { select: { itemCode: true, name: true, itemType: true } },
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
    opts: { itemId?: string; status?: BomStatus } = {},
  ): Promise<BomEntity[]> {
    await this.access.assertCanBrowseBoms(user);
    const where: Prisma.BomWhereInput = {};
    if (opts.itemId) where.itemId = opts.itemId;
    if (opts.status) where.status = opts.status;
    const rows = await this.prisma.bom.findMany({
      where,
      include: BOM_INCLUDE,
      orderBy: [{ createdAt: 'desc' }],
    });
    return rows.map((r) => this.toEntity(r));
  }

  async listForItem(itemId: string, user: AuthenticatedUser): Promise<BomEntity[]> {
    await this.access.assertCanBrowseBoms(user);
    const rows = await this.prisma.bom.findMany({
      where: { itemId },
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
    await this.access.assertCanBrowseBoms(user);
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

    const item = await this.prisma.item.findUnique({
      where: { id: dto.itemId },
      select: { id: true },
    });
    if (!item) throw new NotFoundException('Item not found');

    // A BOM line may not reference the very item the BOM is for (a trivial cycle).
    if (dto.lines.some((l) => l.itemId === dto.itemId)) {
      throw new BadRequestException(
        'A BOM line cannot reference the same item the BOM is for',
      );
    }
    await this.assertItemsExist(dto.lines.map((l) => l.itemId));

    const nextRevision = await this.nextRevisionNumber(dto.itemId);
    const created = await this.prisma.$transaction(async (tx) => {
      const bom = await tx.bom.create({
        data: {
          itemId: dto.itemId,
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
    if (dto.lines) {
      if (dto.lines.some((l) => l.itemId === bom.itemId)) {
        throw new BadRequestException(
          'A BOM line cannot reference the same item the BOM is for',
        );
      }
      await this.assertItemsExist(dto.lines.map((l) => l.itemId));
    }

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
    const item = await this.prisma.item.findUnique({
      where: { id: bom.itemId },
      select: { name: true },
    });
    for (const head of heads) {
      await this.notifications.notifyBomWorkflow({
        recipientId: head.id,
        actorId: user.id,
        type: NotificationType.BOM_SUBMITTED,
        bomId: id,
        message: `BOM Rev ${bom.revisionNumber} for ${item?.name ?? 'an item'} was submitted for approval`,
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

    // Release gates (both throw with a clear message rather than releasing):
    //  1. Supplier hard-gate — every RAW_MATERIAL line needs a qualified supplier.
    //  2. Cycle safety — the released tree must explode without a cycle.
    await this.assertRawMaterialsQualified(id);
    await this.assertNoReleaseCycle(bom.itemId, id);

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
          itemId: bom.itemId,
          status: BomStatus.RELEASED,
          id: { not: id },
        },
        select: { id: true },
      });
      await tx.bom.updateMany({
        where: {
          itemId: bom.itemId,
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

    const nextRevision = await this.nextRevisionNumber(source.itemId);
    const created = await this.prisma.$transaction(async (tx) => {
      const bom = await tx.bom.create({
        data: {
          itemId: source.itemId,
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
  private async nextRevisionNumber(itemId: string): Promise<number> {
    const latest = await this.prisma.bom.findFirst({
      where: { itemId },
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

  // ── Release gates ────────────────────────────────────────────────────
  /**
   * Supplier hard-gate: every RAW_MATERIAL line on this BOM revision must
   * reference an Item that has at least one qualified (APPROVED /
   * APPROVED_PREFERRED) supplier link. Throws naming the offending item(s).
   * Only the BOM's OWN direct RAW_MATERIAL lines are checked here — child BOMs
   * were themselves gated when they were released.
   */
  private async assertRawMaterialsQualified(bomId: string): Promise<void> {
    const lines = await this.prisma.bomLine.findMany({
      where: { bomId },
      select: {
        item: {
          select: {
            id: true,
            itemCode: true,
            name: true,
            itemType: true,
            supplierLinks: { include: { supplier: { select: { status: true } } } },
          },
        },
      },
    });
    const unqualified: string[] = [];
    for (const line of lines) {
      if (line.item.itemType !== ItemType.RAW_MATERIAL) continue;
      const hasQualified = line.item.supplierLinks.some((sl) =>
        QUALIFIED_SUPPLIER_STATUSES.includes(sl.supplier.status),
      );
      if (!hasQualified) {
        unqualified.push(`${line.item.itemCode} (${line.item.name})`);
      }
    }
    if (unqualified.length > 0) {
      throw new BadRequestException(
        `Cannot release: the following raw material(s) have no qualified (Approved) supplier: ${unqualified.join(
          ', ',
        )}. Link each to an Approved supplier before releasing.`,
      );
    }
  }

  /**
   * Cycle safety: verify the tree rooted at `topItemId` — treating THIS bom as
   * the released revision for its item — explodes without a cycle. Loads every
   * item's currently-released BOM plus this pending one, then runs the pure
   * explosion (which throws on a cycle / excessive depth).
   */
  private async assertNoReleaseCycle(
    topItemId: string,
    pendingBomId: string,
  ): Promise<void> {
    // Released BOMs for all items, plus the pending one keyed to its item.
    const released = await this.prisma.bom.findMany({
      where: {
        OR: [{ status: BomStatus.RELEASED }, { id: pendingBomId }],
      },
      select: {
        id: true,
        itemId: true,
        revisionNumber: true,
        lines: {
          select: {
            itemId: true,
            quantityPerUnit: true,
            wastagePercent: true,
            unitOfMeasure: true,
          },
        },
      },
    });
    // Map itemId -> BOM. The pending one wins for its item (it's about to
    // become the released revision).
    const byItem = new Map<string, ExplodableBom>();
    for (const b of released) {
      if (b.id !== pendingBomId && byItem.has(b.itemId)) continue;
      byItem.set(b.itemId, {
        itemId: b.itemId,
        revisionNumber: b.revisionNumber,
        lines: b.lines,
      });
    }
    try {
      explodeBom(topItemId, (itemId) => byItem.get(itemId) ?? null);
    } catch (err) {
      if (err instanceof BomCycleError || err instanceof BomDepthError) {
        throw new BadRequestException(`Cannot release: ${err.message}`);
      }
      throw err;
    }
  }

  // ── Item ↔ Supplier links (powers the hard-gate) ─────────────────────
  async listItemSuppliers(
    itemId: string,
    user: AuthenticatedUser,
  ): Promise<ItemSupplierEntity[]> {
    await this.access.assertCanReadItems(user);
    const rows = await this.prisma.itemSupplier.findMany({
      where: { itemId },
      include: { supplier: { select: { companyName: true, status: true } } },
      orderBy: { createdAt: 'asc' },
    });
    return rows.map((r) => this.toItemSupplier(r));
  }

  async linkSupplier(
    itemId: string,
    dto: LinkSupplierDto,
    user: AuthenticatedUser,
  ): Promise<ItemSupplierEntity> {
    // Managing supplier links is item technical data — same gate as items.
    await this.access.assertCanManageItems(user);
    const [item, supplier] = await Promise.all([
      this.prisma.item.findUnique({ where: { id: itemId }, select: { id: true } }),
      this.prisma.supplier.findUnique({
        where: { id: dto.supplierId },
        select: { id: true },
      }),
    ]);
    if (!item) throw new NotFoundException('Item not found');
    if (!supplier) throw new NotFoundException('Supplier not found');

    const existing = await this.prisma.itemSupplier.findUnique({
      where: { itemId_supplierId: { itemId, supplierId: dto.supplierId } },
      select: { id: true },
    });
    if (existing) {
      throw new BadRequestException('This supplier is already linked to the item');
    }
    const created = await this.prisma.itemSupplier.create({
      data: {
        itemId,
        supplierId: dto.supplierId,
        supplierPartNumber: dto.supplierPartNumber ?? null,
        createdById: user.id,
      },
      include: { supplier: { select: { companyName: true, status: true } } },
    });
    return this.toItemSupplier(created);
  }

  async unlinkSupplier(
    itemId: string,
    linkId: string,
    user: AuthenticatedUser,
  ): Promise<void> {
    await this.access.assertCanManageItems(user);
    const link = await this.prisma.itemSupplier.findUnique({
      where: { id: linkId },
      select: { id: true, itemId: true },
    });
    if (!link || link.itemId !== itemId) {
      throw new NotFoundException('Supplier link not found for this item');
    }
    await this.prisma.itemSupplier.delete({ where: { id: linkId } });
  }

  private toItemSupplier(r: {
    id: string;
    itemId: string;
    supplierId: string;
    supplierPartNumber: string | null;
    createdById: string;
    createdAt: Date;
    supplier: { companyName: string; status: SupplierStatus };
  }): ItemSupplierEntity {
    return new ItemSupplierEntity({
      id: r.id,
      itemId: r.itemId,
      supplierId: r.supplierId,
      supplierName: r.supplier.companyName,
      supplierStatus: r.supplier.status,
      isQualified: QUALIFIED_SUPPLIER_STATUSES.includes(r.supplier.status),
      supplierPartNumber: r.supplierPartNumber,
      createdById: r.createdById,
      createdAt: r.createdAt.toISOString(),
    });
  }

  private toEntity(b: BomWithRelations): BomEntity {
    const name = (e?: { firstName: string; lastName: string } | null) =>
      e ? `${e.firstName} ${e.lastName}`.trim() : null;
    return new BomEntity({
      id: b.id,
      itemId: b.itemId,
      itemCode: b.item?.itemCode ?? null,
      itemName: b.item?.name ?? null,
      itemType: b.item?.itemType ?? null,
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
