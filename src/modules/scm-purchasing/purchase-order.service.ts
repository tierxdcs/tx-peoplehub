import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  Prisma,
  PurchaseOrderStatus,
  SupplierStatus,
  VendorStatus,
} from '@prisma/client';
import { PrismaService } from '../../core/database/prisma.service';
import { AuthenticatedUser } from '../../common/decorators/current-user.decorator';
import { SalesNumberingService } from '../sales/common/sales-numbering.service';
import { PurchasingAccessService } from './purchasing-access.service';
import {
  CreatePurchaseOrderDto,
  PurchaseOrderLineInputDto,
  UpdatePurchaseOrderDto,
} from './dto/purchase-order.dto';
import {
  PurchaseOrderEntity,
  PurchaseOrderLineEntity,
  QualificationWarningEntity,
} from './entities/purchase-order.entity';

/** Supplier/Vendor states that count as "qualified" (no warning). */
const QUALIFIED_SUPPLIER: SupplierStatus[] = [
  SupplierStatus.APPROVED,
  SupplierStatus.APPROVED_PREFERRED,
];
const QUALIFIED_VENDOR: VendorStatus[] = [
  VendorStatus.APPROVED,
  VendorStatus.APPROVED_PREFERRED,
];

const PO_INCLUDE = {
  supplier: { select: { companyName: true, status: true } },
  vendor: { select: { companyName: true, status: true } },
  createdBy: { select: { firstName: true, lastName: true } },
  lines: {
    orderBy: { sequence: 'asc' as const },
    include: { item: { select: { itemCode: true, name: true } } },
  },
} satisfies Prisma.PurchaseOrderInclude;

type PoWithRelations = Prisma.PurchaseOrderGetPayload<{ include: typeof PO_INCLUDE }>;

/**
 * Purchase Orders (Stores Phase 1). Foundation only — no GRN/QC/material issue.
 *
 * Status: Phase 1 supports the MANUAL transitions DRAFT → ISSUED → CANCELLED.
 * PARTIALLY_RECEIVED / FULLY_RECEIVED are receipt-derived and belong to Phase 2;
 * the transition logic is centralised in assertTransitionAllowed() so Phase 2
 * can add the computed transitions without reworking this service.
 */
@Injectable()
export class PurchaseOrderService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: PurchasingAccessService,
    private readonly numbering: SalesNumberingService,
  ) {}

  // ── Reads (company-wide) ─────────────────────────────────────────────
  async list(
    user: AuthenticatedUser,
    opts: { status?: PurchaseOrderStatus } = {},
  ): Promise<PurchaseOrderEntity[]> {
    void user; // company-wide read — any authenticated user
    const where: Prisma.PurchaseOrderWhereInput = {};
    if (opts.status) where.status = opts.status;
    const rows = await this.prisma.purchaseOrder.findMany({
      where,
      include: PO_INCLUDE,
      orderBy: { createdAt: 'desc' },
    });
    return rows.map((r) => this.toEntity(r));
  }

  async get(id: string): Promise<PurchaseOrderEntity> {
    const row = await this.prisma.purchaseOrder.findUnique({
      where: { id },
      include: PO_INCLUDE,
    });
    if (!row) throw new NotFoundException('Purchase order not found');
    return this.toEntity(row);
  }

  // ── Create / edit ────────────────────────────────────────────────────
  async create(
    dto: CreatePurchaseOrderDto,
    user: AuthenticatedUser,
  ): Promise<PurchaseOrderEntity> {
    await this.access.assertCanManagePurchaseOrders(user);
    this.assertExactlyOnePartner(dto.supplierId, dto.vendorId);
    const warning = await this.resolvePartnerAndWarn(dto.supplierId, dto.vendorId);
    const lines = await this.buildLineData(dto.lines);

    const created = await this.prisma.$transaction(async (tx) => {
      const poNumber = await this.numbering.nextNumber(
        'PO',
        'purchase_order',
        new Date().getUTCFullYear(),
        tx,
      );
      return tx.purchaseOrder.create({
        data: {
          poNumber,
          status: PurchaseOrderStatus.DRAFT,
          supplierId: dto.supplierId ?? null,
          vendorId: dto.vendorId ?? null,
          orderDate: dto.orderDate ? new Date(dto.orderDate) : new Date(),
          expectedDeliveryDate: dto.expectedDeliveryDate
            ? new Date(dto.expectedDeliveryDate)
            : null,
          notes: dto.notes ?? null,
          createdById: user.id,
          lines: { create: lines },
        },
      });
    });
    const entity = await this.get(created.id);
    entity.qualificationWarning = warning;
    return entity;
  }

  async update(
    id: string,
    dto: UpdatePurchaseOrderDto,
    user: AuthenticatedUser,
  ): Promise<PurchaseOrderEntity> {
    await this.access.assertCanManagePurchaseOrders(user);
    const po = await this.prisma.purchaseOrder.findUnique({ where: { id } });
    if (!po) throw new NotFoundException('Purchase order not found');
    // Only a DRAFT PO is editable — an ISSUED/CANCELLED order is a commitment.
    if (po.status !== PurchaseOrderStatus.DRAFT) {
      throw new BadRequestException(
        `Only a DRAFT purchase order can be edited (current: ${po.status})`,
      );
    }

    // Determine the resulting partner (fall back to existing when omitted) and
    // re-validate exactly-one-of + qualification.
    const nextSupplierId =
      dto.supplierId !== undefined ? dto.supplierId : po.supplierId;
    const nextVendorId =
      dto.vendorId !== undefined ? dto.vendorId : po.vendorId;
    this.assertExactlyOnePartner(nextSupplierId, nextVendorId);
    const warning = await this.resolvePartnerAndWarn(
      nextSupplierId,
      nextVendorId,
    );

    const lineData = dto.lines ? await this.buildLineData(dto.lines) : undefined;

    await this.prisma.purchaseOrder.update({
      where: { id },
      data: {
        // Setting one partner clears the other (a PO always has exactly one).
        supplierId: nextSupplierId ?? null,
        vendorId: nextVendorId ?? null,
        ...(dto.orderDate !== undefined
          ? { orderDate: dto.orderDate ? new Date(dto.orderDate) : new Date() }
          : {}),
        ...(dto.expectedDeliveryDate !== undefined
          ? {
              expectedDeliveryDate: dto.expectedDeliveryDate
                ? new Date(dto.expectedDeliveryDate)
                : null,
            }
          : {}),
        ...(dto.notes !== undefined ? { notes: dto.notes } : {}),
        ...(lineData
          ? { lines: { deleteMany: {}, create: lineData } }
          : {}),
      },
    });
    const entity = await this.get(id);
    entity.qualificationWarning = warning;
    return entity;
  }

  // ── Status transitions ───────────────────────────────────────────────
  async issue(id: string, user: AuthenticatedUser): Promise<PurchaseOrderEntity> {
    return this.transition(id, PurchaseOrderStatus.ISSUED, user, {
      issuedAt: new Date(),
    });
  }

  async cancel(id: string, user: AuthenticatedUser): Promise<PurchaseOrderEntity> {
    return this.transition(id, PurchaseOrderStatus.CANCELLED, user, {
      cancelledAt: new Date(),
    });
  }

  private async transition(
    id: string,
    to: PurchaseOrderStatus,
    user: AuthenticatedUser,
    extra: Prisma.PurchaseOrderUpdateInput,
  ): Promise<PurchaseOrderEntity> {
    await this.access.assertCanManagePurchaseOrders(user);
    const po = await this.prisma.purchaseOrder.findUnique({ where: { id } });
    if (!po) throw new NotFoundException('Purchase order not found');
    this.assertTransitionAllowed(po.status, to);
    await this.prisma.purchaseOrder.update({
      where: { id },
      data: { status: to, ...extra },
    });
    return this.get(id);
  }

  /**
   * The manual transition matrix for Phase 1. PARTIALLY_RECEIVED / FULLY_RECEIVED
   * are intentionally NOT reachable manually — they are computed from GRN data
   * in Phase 2, which will extend this map (and add a receipt-driven code path)
   * rather than replace it.
   */
  private assertTransitionAllowed(
    from: PurchaseOrderStatus,
    to: PurchaseOrderStatus,
  ): void {
    const MANUAL_TRANSITIONS: Record<PurchaseOrderStatus, PurchaseOrderStatus[]> = {
      [PurchaseOrderStatus.DRAFT]: [
        PurchaseOrderStatus.ISSUED,
        PurchaseOrderStatus.CANCELLED,
      ],
      // An issued PO can still be cancelled (before any receipts exist).
      [PurchaseOrderStatus.ISSUED]: [PurchaseOrderStatus.CANCELLED],
      // Receipt-derived states — no manual transitions out of them in Phase 1.
      [PurchaseOrderStatus.PARTIALLY_RECEIVED]: [],
      [PurchaseOrderStatus.FULLY_RECEIVED]: [],
      [PurchaseOrderStatus.CANCELLED]: [],
    };
    if (!MANUAL_TRANSITIONS[from].includes(to)) {
      throw new BadRequestException(
        `Cannot move a purchase order from ${from} to ${to}`,
      );
    }
  }

  // ── Helpers ──────────────────────────────────────────────────────────
  private assertExactlyOnePartner(
    supplierId?: string | null,
    vendorId?: string | null,
  ): void {
    const hasSupplier = !!supplierId;
    const hasVendor = !!vendorId;
    if (hasSupplier === hasVendor) {
      throw new BadRequestException(
        'A purchase order must reference exactly one of a supplier or a vendor',
      );
    }
  }

  /**
   * Validates the chosen partner exists and returns a non-blocking qualification
   * warning if it isn't APPROVED / APPROVED_PREFERRED. Never throws on an
   * unqualified partner — emergency purchases are allowed (warning only).
   */
  private async resolvePartnerAndWarn(
    supplierId?: string | null,
    vendorId?: string | null,
  ): Promise<QualificationWarningEntity | null> {
    if (supplierId) {
      const supplier = await this.prisma.supplier.findUnique({
        where: { id: supplierId },
        select: { id: true, companyName: true, status: true },
      });
      if (!supplier) throw new NotFoundException('Supplier not found');
      if (!QUALIFIED_SUPPLIER.includes(supplier.status)) {
        return new QualificationWarningEntity({
          partnerType: 'SUPPLIER',
          partnerId: supplier.id,
          partnerName: supplier.companyName,
          status: supplier.status,
          message: `Supplier "${supplier.companyName}" is not qualified (status ${supplier.status}). The purchase order is allowed, but review before issuing.`,
        });
      }
      return null;
    }
    // vendorId
    const vendor = await this.prisma.vendor.findUnique({
      where: { id: vendorId as string },
      select: { id: true, companyName: true, status: true },
    });
    if (!vendor) throw new NotFoundException('Vendor not found');
    if (!QUALIFIED_VENDOR.includes(vendor.status)) {
      return new QualificationWarningEntity({
        partnerType: 'VENDOR',
        partnerId: vendor.id,
        partnerName: vendor.companyName,
        status: vendor.status,
        message: `Vendor "${vendor.companyName}" is not qualified (status ${vendor.status}). The purchase order is allowed, but review before issuing.`,
      });
    }
    return null;
  }

  /**
   * Validate items exist + active, snapshot the UoM, and compute lineTotal
   * (orderedQuantity × unitPrice). Returns Prisma create rows.
   */
  private async buildLineData(
    lines: PurchaseOrderLineInputDto[],
  ): Promise<Prisma.PurchaseOrderLineCreateWithoutPurchaseOrderInput[]> {
    const itemIds = [...new Set(lines.map((l) => l.itemId))];
    const items = await this.prisma.item.findMany({
      where: { id: { in: itemIds } },
      select: { id: true, isActive: true, baseUnitOfMeasure: true },
    });
    const byId = new Map(items.map((i) => [i.id, i]));
    if (items.length !== itemIds.length) {
      throw new BadRequestException('One or more lines reference an unknown item');
    }
    const inactive = items.filter((i) => !i.isActive);
    if (inactive.length > 0) {
      throw new BadRequestException('One or more lines reference an inactive item');
    }
    return lines.map((l, i) => {
      const qty = new Prisma.Decimal(l.orderedQuantity);
      const price = new Prisma.Decimal(l.unitPrice);
      return {
        item: { connect: { id: l.itemId } },
        orderedQuantity: qty,
        unitPrice: price,
        unitOfMeasure: l.unitOfMeasure ?? byId.get(l.itemId)!.baseUnitOfMeasure,
        lineTotal: qty.times(price),
        notes: l.notes ?? null,
        sequence: l.sequence ?? i,
      };
    });
  }

  private toEntity(po: PoWithRelations): PurchaseOrderEntity {
    const total = po.lines.reduce(
      (sum, l) => sum.plus(l.lineTotal),
      new Prisma.Decimal(0),
    );
    return new PurchaseOrderEntity({
      id: po.id,
      poNumber: po.poNumber,
      status: po.status,
      supplierId: po.supplierId,
      supplierName: po.supplier?.companyName ?? null,
      vendorId: po.vendorId,
      vendorName: po.vendor?.companyName ?? null,
      orderDate: po.orderDate.toISOString(),
      expectedDeliveryDate: po.expectedDeliveryDate
        ? po.expectedDeliveryDate.toISOString()
        : null,
      notes: po.notes,
      createdById: po.createdById,
      createdByName: po.createdBy
        ? `${po.createdBy.firstName} ${po.createdBy.lastName}`.trim()
        : null,
      issuedAt: po.issuedAt ? po.issuedAt.toISOString() : null,
      cancelledAt: po.cancelledAt ? po.cancelledAt.toISOString() : null,
      totalAmount: total.toFixed(2),
      lines: po.lines.map(
        (l) =>
          new PurchaseOrderLineEntity({
            id: l.id,
            itemId: l.itemId,
            itemCode: l.item.itemCode,
            itemName: l.item.name,
            orderedQuantity: l.orderedQuantity.toString(),
            unitPrice: l.unitPrice.toString(),
            unitOfMeasure: l.unitOfMeasure,
            lineTotal: l.lineTotal.toString(),
            notes: l.notes,
            sequence: l.sequence,
          }),
      ),
      qualificationWarning: null,
      createdAt: po.createdAt.toISOString(),
      updatedAt: po.updatedAt.toISOString(),
    });
  }
}
