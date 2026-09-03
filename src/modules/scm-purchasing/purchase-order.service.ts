import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  NotificationType,
  Prisma,
  PurchaseOrderApprovalLevel,
  PurchaseOrderApprovalStatus,
  PurchaseOrderStatus,
  Role,
  SupplierStatus,
  VendorStatus,
} from '@prisma/client';
import { PrismaService } from '../../core/database/prisma.service';
import { AuthenticatedUser } from '../../common/decorators/current-user.decorator';
import {
  EMPTY_PENDING_QUEUE,
  PendingQueue,
} from '../../common/types/pending-queue';
import { formatIndianAmount } from '../../common/utils/indian-money.util';
import { SalesNumberingService } from '../sales/common/sales-numbering.service';
import { PushEventsService } from '../notifications/push-events.service';
import { ApService } from '../finance-ap/ap.service';
import { PurchasingAccessService } from './purchasing-access.service';
import {
  CreatePurchaseOrderDto,
  PurchaseOrderLineInputDto,
  UpdatePurchaseOrderDto,
  RejectAdHocPurchaseOrderDto,
} from './dto/purchase-order.dto';
import {
  PurchaseOrderAdvanceEntity,
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
  // contactEmail is here for the entity's `partyEmail` — the address the
  // "Email to Supplier" action would send to, shown before the user commits.
  supplier: { select: { companyName: true, status: true, contactEmail: true } },
  vendor: { select: { companyName: true, status: true, contactEmail: true } },
  createdBy: { select: { firstName: true, lastName: true } },
  approvals: {
    orderBy: { sequence: 'asc' as const },
    include: {
      decidedBy: { select: { firstName: true, lastName: true } },
    },
  },
  lines: {
    orderBy: { sequence: 'asc' as const },
    include: { item: { select: { itemCode: true, name: true } } },
  },
  // Newest first: after a rejected advance is re-raised, the live request is the
  // most recent one, and that is the only one the PO page should be showing.
  advancePayments: {
    orderBy: { createdAt: 'desc' as const },
    select: {
      id: true,
      paymentNumber: true,
      status: true,
      plannedDate: true,
      executedDate: true,
      bankReference: true,
      rejectionComment: true,
    },
  },
} satisfies Prisma.PurchaseOrderInclude;

type PoWithRelations = Prisma.PurchaseOrderGetPayload<{
  include: typeof PO_INCLUDE;
}>;

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
    // PushEventsModule is @Global, so this needs no import edge here.
    private readonly pushEvents: PushEventsService,
    // Raises the advance-payment request when a PO carrying an advance is
    // issued. Reusing AP's payment rather than a parallel request model means
    // there is only ever one record of whether the vendor has been paid.
    private readonly ap: ApService,
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
    const canDelete = await this.access.canDeletePurchaseOrders(user);
    return rows.map((r) => ({
      ...this.toEntity(r),
      canDelete:
        canDelete &&
        r.status !== PurchaseOrderStatus.ISSUED &&
        r.status !== PurchaseOrderStatus.FULLY_RECEIVED,
    }));
  }

  async get(id: string): Promise<PurchaseOrderEntity> {
    const row = await this.prisma.purchaseOrder.findUnique({
      where: { id },
      include: PO_INCLUDE,
    });
    if (!row) throw new NotFoundException('Purchase order not found');
    return this.toEntity(row);
  }

  async remove(id: string, user: AuthenticatedUser) {
    await this.access.assertCanDeletePurchaseOrders(user);
    const po = await this.prisma.purchaseOrder.findUnique({
      where: { id },
      select: {
        poNumber: true,
        status: true,
        _count: {
          select: {
            goodsReceiptNotes: true,
            apInvoices: true,
            advancePayments: true,
          },
        },
      },
    });
    if (!po) throw new NotFoundException('Purchase order not found');
    if (
      po.status === PurchaseOrderStatus.ISSUED ||
      po.status === PurchaseOrderStatus.FULLY_RECEIVED
    ) {
      throw new BadRequestException(
        `${po.status.replaceAll('_', ' ')} purchase orders cannot be deleted`,
      );
    }
    // A hard delete must never erase receiving, QC, stock or accounting audit.
    // PARTIALLY_RECEIVED normally lands here because it owns at least one GRN.
    // advancePayments is checked here for the message: the FK is ON DELETE
    // RESTRICT, so without it a cancelled PO whose advance was already paid
    // would fail with a raw constraint error instead of an explanation.
    if (
      po._count.goodsReceiptNotes > 0 ||
      po._count.apInvoices > 0 ||
      po._count.advancePayments > 0
    ) {
      throw new BadRequestException(
        'This purchase order has linked GRN or Accounts Payable records and cannot be deleted',
      );
    }
    await this.prisma.purchaseOrder.delete({ where: { id } });
    return { id, poNumber: po.poNumber, deleted: true };
  }

  // ── Create / edit ────────────────────────────────────────────────────
  async create(
    dto: CreatePurchaseOrderDto,
    user: AuthenticatedUser,
  ): Promise<PurchaseOrderEntity> {
    await this.access.assertCanManagePurchaseOrders(user);
    this.assertAtMostOnePartner(dto.supplierId, dto.vendorId);
    const isAdHoc = !dto.supplierId && !dto.vendorId;
    const adHocPartyName = dto.adHocPartyName?.trim() ?? '';
    if (isAdHoc && !adHocPartyName) {
      throw new BadRequestException(
        'Party name is required for an ad-hoc purchase order',
      );
    }
    this.assertAdvanceAllowed(dto.advancePercent, isAdHoc);
    const warning = await this.resolvePartnerAndWarn(
      dto.supplierId,
      dto.vendorId,
    );
    const lines = await this.buildLineData(dto.lines, isAdHoc);

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
          adHocPartyName: isAdHoc ? adHocPartyName : null,
          adHocContactInfo: isAdHoc
            ? dto.adHocContactInfo?.trim() || null
            : null,
          adHocPartyAddress: isAdHoc
            ? dto.adHocPartyAddress?.trim() || null
            : null,
          orderDate: dto.orderDate ? new Date(dto.orderDate) : new Date(),
          expectedDeliveryDate: dto.expectedDeliveryDate
            ? new Date(dto.expectedDeliveryDate)
            : null,
          notes: dto.notes ?? null,
          advancePercent: dto.advancePercent ?? null,
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
    this.assertAtMostOnePartner(nextSupplierId, nextVendorId);
    const warning = await this.resolvePartnerAndWarn(
      nextSupplierId,
      nextVendorId,
    );

    const isAdHoc = !nextSupplierId && !nextVendorId;
    // Validate the advance that will *result* from this edit, not just the one
    // sent: switching an advance-carrying PO to an ad-hoc party would otherwise
    // leave a commitment with no payables account to pay it from.
    const nextAdvancePercent =
      dto.advancePercent !== undefined ? dto.advancePercent : po.advancePercent;
    this.assertAdvanceAllowed(nextAdvancePercent, isAdHoc);
    const lineData = dto.lines
      ? await this.buildLineData(dto.lines, isAdHoc)
      : undefined;

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
        ...(dto.advancePercent !== undefined
          ? { advancePercent: dto.advancePercent }
          : {}),
        ...(lineData ? { lines: { deleteMany: {}, create: lineData } } : {}),
      },
    });
    const entity = await this.get(id);
    entity.qualificationWarning = warning;
    return entity;
  }

  // ── Status transitions ───────────────────────────────────────────────
  async submitForApproval(
    id: string,
    user: AuthenticatedUser,
  ): Promise<PurchaseOrderEntity> {
    await this.access.assertCanManagePurchaseOrders(user);
    const po = await this.prisma.purchaseOrder.findUnique({
      where: { id },
      include: { lines: { select: { lineTotal: true } } },
    });
    if (!po) throw new NotFoundException('Purchase order not found');
    if (po.status !== PurchaseOrderStatus.DRAFT) {
      throw new BadRequestException(
        'Only a DRAFT purchase order can be submitted',
      );
    }
    const amount = po.lines.reduce(
      (sum, line) => sum.plus(line.lineTotal),
      new Prisma.Decimal(0),
    );
    if (amount.lte(0)) {
      throw new BadRequestException(
        'Purchase order value must be greater than zero',
      );
    }
    const levels: PurchaseOrderApprovalLevel[] = [
      PurchaseOrderApprovalLevel.CSCO,
    ];
    if (amount.gt(2_500_000)) levels.push(PurchaseOrderApprovalLevel.COO);
    if (amount.gt(5_000_000) || (!po.supplierId && !po.vendorId)) {
      levels.push(PurchaseOrderApprovalLevel.CEO);
    }

    await this.prisma.$transaction(async (tx) => {
      const claimed = await tx.purchaseOrder.updateMany({
        where: { id, status: PurchaseOrderStatus.DRAFT },
        data: {
          status: PurchaseOrderStatus.PENDING_CSCO_APPROVAL,
          approvalAmount: amount,
          rejectedById: null,
          rejectedAt: null,
          rejectionComment: null,
        },
      });
      if (claimed.count !== 1) {
        throw new BadRequestException(
          'This purchase order is no longer a DRAFT',
        );
      }
      await tx.purchaseOrderApproval.deleteMany({
        where: { purchaseOrderId: id },
      });
      await tx.purchaseOrderApproval.createMany({
        data: levels.map((level, sequence) => ({
          purchaseOrderId: id,
          level,
          sequence: sequence + 1,
          amountSnapshot: amount,
          status:
            sequence === 0
              ? PurchaseOrderApprovalStatus.PENDING
              : PurchaseOrderApprovalStatus.WAITING,
        })),
      });
    });
    await this.notifyApprovalRequired(
      id,
      po.poNumber,
      user,
      PurchaseOrderApprovalLevel.CSCO,
    );
    return this.get(id);
  }

  async approve(
    id: string,
    user: AuthenticatedUser,
  ): Promise<PurchaseOrderEntity> {
    const po = await this.prisma.purchaseOrder.findUnique({
      where: { id },
      include: { approvals: { orderBy: { sequence: 'asc' } } },
    });
    if (!po) throw new NotFoundException('Purchase order not found');
    const current = po.approvals.find(
      (approval) => approval.status === PurchaseOrderApprovalStatus.PENDING,
    );
    if (!current || po.status !== this.pendingStatus(current.level)) {
      throw new BadRequestException(
        'This purchase order is not awaiting your approval',
      );
    }
    await this.assertApprovalAuthority(current.level, user);
    const next = po.approvals.find(
      (approval) => approval.sequence === current.sequence + 1,
    );
    await this.prisma.$transaction(async (tx) => {
      const claimed = await tx.purchaseOrderApproval.updateMany({
        where: { id: current.id, status: PurchaseOrderApprovalStatus.PENDING },
        data: {
          status: PurchaseOrderApprovalStatus.APPROVED,
          decidedById: user.id,
          decidedAt: new Date(),
          comment: null,
        },
      });
      if (claimed.count !== 1) {
        throw new BadRequestException('This approval has already been decided');
      }
      if (next) {
        await tx.purchaseOrderApproval.update({
          where: { id: next.id },
          data: { status: PurchaseOrderApprovalStatus.PENDING },
        });
      }
      await tx.purchaseOrder.update({
        where: { id },
        data: {
          status: next
            ? this.pendingStatus(next.level)
            : PurchaseOrderStatus.APPROVED,
          ...(current.level === PurchaseOrderApprovalLevel.CEO
            ? { ceoApprovedById: user.id, ceoApprovedAt: new Date() }
            : {}),
        },
      });
    });
    if (next)
      await this.notifyApprovalRequired(id, po.poNumber, user, next.level);
    return this.get(id);
  }

  async rejectApproval(
    id: string,
    dto: RejectAdHocPurchaseOrderDto,
    user: AuthenticatedUser,
  ): Promise<PurchaseOrderEntity> {
    const comment = dto.comment?.trim();
    if (!comment)
      throw new BadRequestException('A rejection comment is required');
    const po = await this.prisma.purchaseOrder.findUnique({
      where: { id },
      include: { approvals: { orderBy: { sequence: 'asc' } } },
    });
    if (!po) throw new NotFoundException('Purchase order not found');
    const current = po.approvals.find(
      (approval) => approval.status === PurchaseOrderApprovalStatus.PENDING,
    );
    if (!current || po.status !== this.pendingStatus(current.level)) {
      throw new BadRequestException(
        'This purchase order is not awaiting your decision',
      );
    }
    await this.assertApprovalAuthority(current.level, user);
    await this.prisma.$transaction(async (tx) => {
      await tx.purchaseOrderApproval.update({
        where: { id: current.id },
        data: {
          status: PurchaseOrderApprovalStatus.REJECTED,
          decidedById: user.id,
          decidedAt: new Date(),
          comment,
        },
      });
      await tx.purchaseOrder.update({
        where: { id },
        data: {
          status: PurchaseOrderStatus.REJECTED,
          rejectedById: user.id,
          rejectedAt: new Date(),
          rejectionComment: comment,
        },
      });
    });
    return this.get(id);
  }

  /**
   * Issue the order to the party. When the PO carries an advance commitment this
   * is also the moment the request reaches Accounts: issuing is when the promise
   * to pay becomes real (the party receives a document saying so), so the
   * payment and the ISSUED status are written in one transaction. An ISSUED PO
   * promising an advance that Accounts was never told about is exactly the
   * failure this feature exists to remove.
   *
   * The rupee amount is snapshotted here rather than recomputed on read, so the
   * printed PO, the request Accounts sees, and the PO page can never disagree.
   */
  async issue(
    id: string,
    user: AuthenticatedUser,
  ): Promise<PurchaseOrderEntity> {
    await this.access.assertCanManagePurchaseOrders(user);
    const po = await this.prisma.purchaseOrder.findUnique({
      where: { id },
      include: { lines: { select: { lineTotal: true } } },
    });
    if (!po) throw new NotFoundException('Purchase order not found');
    if (po.status !== PurchaseOrderStatus.APPROVED) {
      throw new BadRequestException(
        'A purchase order cannot be issued until every required approval is complete',
      );
    }
    this.assertTransitionAllowed(po.status, PurchaseOrderStatus.ISSUED);

    const issuedAt = new Date();
    const total = po.lines.reduce(
      (sum, l) => sum.plus(l.lineTotal),
      new Prisma.Decimal(0),
    );
    const advanceAmount = po.advancePercent
      ? this.computeAdvanceAmount(total, po.advancePercent)
      : null;
    if (advanceAmount && advanceAmount.lte(0)) {
      throw new BadRequestException(
        'The advance works out to zero at this order value — raise the percentage or remove the advance',
      );
    }

    const request = await this.prisma.$transaction(async (tx) => {
      const claimed = await tx.purchaseOrder.updateMany({
        where: { id, status: PurchaseOrderStatus.APPROVED },
        data: {
          status: PurchaseOrderStatus.ISSUED,
          issuedAt,
          ...(advanceAmount ? { advanceAmount } : {}),
        },
      });
      if (claimed.count !== 1) {
        throw new BadRequestException(
          'This purchase order is no longer APPROVED',
        );
      }
      if (!advanceAmount || !po.advancePercent) return null;
      return this.ap.createPurchaseOrderAdvanceTx(tx, {
        purchaseOrderId: id,
        poNumber: po.poNumber,
        supplierId: po.supplierId,
        vendorId: po.vendorId,
        amount: advanceAmount,
        advancePercent: po.advancePercent,
        // Date-only, matching how AP stores every other payment's plannedDate.
        plannedDate: new Date(
          `${issuedAt.toISOString().slice(0, 10)}T00:00:00.000Z`,
        ),
        createdById: user.id,
      });
    });

    // After the commit: a failed notification must not un-issue the order.
    if (request && advanceAmount && po.advancePercent) {
      await this.notifyAdvanceRequested(
        id,
        po.poNumber,
        advanceAmount,
        po.advancePercent,
      );
    }
    return this.get(id);
  }

  /**
   * The advance in rupees: a percentage of the pre-tax line total, which is the
   * same basis as the approvalAmount snapshot. Decimal throughout — a rupee
   * figure that moves real cash must never round-trip through a JS float.
   */
  private computeAdvanceAmount(
    total: Prisma.Decimal,
    percent: Prisma.Decimal,
  ): Prisma.Decimal {
    return total.times(percent).dividedBy(100).toDecimalPlaces(2);
  }

  /**
   * An advance needs a party with a payables account: AccountsPayablePayment
   * requires a Supplier or Vendor id, so an ad-hoc PO has nothing to raise the
   * request against. Range (0.01–100) is enforced by the DTO.
   */
  private assertAdvanceAllowed(
    percent: Prisma.Decimal | number | null | undefined,
    isAdHoc: boolean,
  ): void {
    if (percent === null || percent === undefined) return;
    if (isAdHoc) {
      throw new BadRequestException(
        'An advance can only be committed to a registered supplier or vendor — clear the advance percentage first',
      );
    }
  }

  /**
   * Tells Accounts an advance is due. Audience is the ACCOUNTS vertical, the
   * same set that can act on the payment once it lands in their queue.
   */
  private async notifyAdvanceRequested(
    purchaseOrderId: string,
    poNumber: string,
    amount: Prisma.Decimal,
    percent: Prisma.Decimal,
  ): Promise<void> {
    const recipients = await this.prisma.employee.findMany({
      where: { status: 'ACTIVE', vertical: { code: 'ACCOUNTS' } },
      select: { id: true },
    });
    if (recipients.length === 0) return;
    const message =
      `${poNumber} has been issued with a ${percent.toFixed(2)}% advance of ` +
      `₹${formatIndianAmount(amount.toFixed(2))} payable before delivery`;
    await this.prisma.notification.createMany({
      data: recipients.map((employee) => ({
        employeeId: employee.id,
        type: NotificationType.PO_ADVANCE_PAYMENT_REQUESTED,
        relatedPurchaseOrderId: purchaseOrderId,
        message,
      })),
    });
  }

  async cancel(
    id: string,
    user: AuthenticatedUser,
  ): Promise<PurchaseOrderEntity> {
    return this.transition(id, PurchaseOrderStatus.CANCELLED, user, {
      cancelledAt: new Date(),
    });
  }

  async approveAdHoc(
    id: string,
    user: AuthenticatedUser,
  ): Promise<PurchaseOrderEntity> {
    return this.approve(id, user);
  }

  async rejectAdHoc(
    id: string,
    dto: RejectAdHocPurchaseOrderDto,
    user: AuthenticatedUser,
  ): Promise<PurchaseOrderEntity> {
    return this.rejectApproval(id, dto, user);
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
    const MANUAL_TRANSITIONS: Record<
      PurchaseOrderStatus,
      PurchaseOrderStatus[]
    > = {
      [PurchaseOrderStatus.PENDING_CEO_APPROVAL]: [
        PurchaseOrderStatus.CANCELLED,
      ],
      [PurchaseOrderStatus.PENDING_CSCO_APPROVAL]: [
        PurchaseOrderStatus.CANCELLED,
      ],
      [PurchaseOrderStatus.PENDING_COO_APPROVAL]: [
        PurchaseOrderStatus.CANCELLED,
      ],
      [PurchaseOrderStatus.DRAFT]: [PurchaseOrderStatus.CANCELLED],
      [PurchaseOrderStatus.APPROVED]: [
        PurchaseOrderStatus.ISSUED,
        PurchaseOrderStatus.CANCELLED,
      ],
      // An issued PO can still be cancelled (before any receipts exist).
      [PurchaseOrderStatus.ISSUED]: [PurchaseOrderStatus.CANCELLED],
      // Receipt-derived states — no manual transitions out of them in Phase 1.
      [PurchaseOrderStatus.PARTIALLY_RECEIVED]: [],
      [PurchaseOrderStatus.FULLY_RECEIVED]: [],
      [PurchaseOrderStatus.REJECTED]: [],
      [PurchaseOrderStatus.CANCELLED]: [],
    };
    if (!MANUAL_TRANSITIONS[from].includes(to)) {
      throw new BadRequestException(
        `Cannot move a purchase order from ${from} to ${to}`,
      );
    }
  }

  // ── Helpers ──────────────────────────────────────────────────────────
  private assertAtMostOnePartner(
    supplierId?: string | null,
    vendorId?: string | null,
  ): void {
    const hasSupplier = !!supplierId;
    const hasVendor = !!vendorId;
    if (hasSupplier && hasVendor) {
      throw new BadRequestException(
        'A purchase order cannot reference both a supplier and a vendor',
      );
    }
  }

  private pendingStatus(
    level: PurchaseOrderApprovalLevel,
  ): PurchaseOrderStatus {
    return {
      [PurchaseOrderApprovalLevel.CSCO]:
        PurchaseOrderStatus.PENDING_CSCO_APPROVAL,
      [PurchaseOrderApprovalLevel.COO]:
        PurchaseOrderStatus.PENDING_COO_APPROVAL,
      [PurchaseOrderApprovalLevel.CEO]:
        PurchaseOrderStatus.PENDING_CEO_APPROVAL,
    }[level];
  }

  private async assertApprovalAuthority(
    level: PurchaseOrderApprovalLevel,
    user: AuthenticatedUser,
  ): Promise<void> {
    if (level === PurchaseOrderApprovalLevel.CEO) {
      if (user.role === Role.SUPER_ADMIN) return;
      throw new ForbiddenException(
        'Only the CEO/SuperAdmin may decide the CEO approval step',
      );
    }
    const employee = await this.prisma.employee.findUnique({
      where: { id: user.id },
      select: { status: true, isScmHead: true, isProductionHead: true },
    });
    const allowed =
      employee?.status === 'ACTIVE' &&
      (level === PurchaseOrderApprovalLevel.CSCO
        ? employee.isScmHead
        : employee.isProductionHead);
    if (!allowed) {
      throw new ForbiddenException(
        level === PurchaseOrderApprovalLevel.CSCO
          ? 'Only the designated CSCO/SCM Head may decide this approval step'
          : 'Only the designated COO/Production Head may decide this approval step',
      );
    }
  }

  private async notifyApprovalRequired(
    id: string,
    poNumber: string,
    actor: AuthenticatedUser,
    level: PurchaseOrderApprovalLevel,
  ): Promise<void> {
    const recipients = await this.prisma.employee.findMany({
      where: {
        status: 'ACTIVE',
        ...(level === PurchaseOrderApprovalLevel.CSCO
          ? { isScmHead: true }
          : level === PurchaseOrderApprovalLevel.COO
            ? { isProductionHead: true }
            : { role: Role.SUPER_ADMIN }),
      },
      select: { id: true },
    });
    void this.pushEvents.approvalRequired({
      kind: 'purchase-order',
      audience: { employeeIds: recipients.map((employee) => employee.id) },
      reference: `${poNumber} — ${level} approval`,
      requestedById: actor.id,
      recordId: id,
      url: `/stores/purchase-orders/${id}`,
      actorId: actor.id,
    });
  }

  /** Approval queue scoped to the caller's CSCO, COO, or CEO authority. */
  async pendingApprovalQueue(user: AuthenticatedUser): Promise<PendingQueue> {
    let statuses: PurchaseOrderStatus[] = [];
    if (user.role === Role.SUPER_ADMIN) {
      statuses = [PurchaseOrderStatus.PENDING_CEO_APPROVAL];
    } else {
      const employee = await this.prisma.employee.findUnique({
        where: { id: user.id },
        select: { status: true, isScmHead: true, isProductionHead: true },
      });
      if (employee?.status !== 'ACTIVE') return EMPTY_PENDING_QUEUE;
      if (employee.isScmHead) {
        statuses.push(PurchaseOrderStatus.PENDING_CSCO_APPROVAL);
      }
      if (employee.isProductionHead) {
        statuses.push(PurchaseOrderStatus.PENDING_COO_APPROVAL);
      }
    }
    if (statuses.length === 0) return EMPTY_PENDING_QUEUE;
    const where = { status: { in: statuses } };
    const [count, oldest] = await Promise.all([
      this.prisma.purchaseOrder.count({ where }),
      this.prisma.purchaseOrder.findFirst({
        where,
        orderBy: { createdAt: 'asc' },
        select: { createdAt: true },
      }),
    ]);
    return { count, oldestPendingAt: oldest?.createdAt ?? null };
  }

  /** Backward-compatible alias for older callers. */
  async pendingCeoApprovalQueue(
    user: AuthenticatedUser,
  ): Promise<PendingQueue> {
    return this.pendingApprovalQueue(user);
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
    if (!supplierId && !vendorId) return null;
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
    allowAdHocLines: boolean,
  ): Promise<Prisma.PurchaseOrderLineCreateWithoutPurchaseOrderInput[]> {
    for (const line of lines) {
      const hasItem = !!line.itemId?.trim();
      const hasAdHocItem = !!line.adHocItemName?.trim();
      if (hasItem === hasAdHocItem) {
        throw new BadRequestException(
          'Each purchase order line must contain either an Item Master item or a free-text item name, but not both',
        );
      }
      if (hasAdHocItem && !allowAdHocLines) {
        throw new BadRequestException(
          'Free-text lines are available only for an ad-hoc/unlisted party purchase order',
        );
      }
      if (hasAdHocItem && !line.unitOfMeasure?.trim()) {
        throw new BadRequestException(
          'Unit of measure is required for a free-text purchase order line',
        );
      }
    }
    const itemIds = [
      ...new Set(lines.flatMap((l) => (l.itemId ? [l.itemId] : []))),
    ];
    const items = await this.prisma.item.findMany({
      where: { id: { in: itemIds } },
      select: { id: true, isActive: true, baseUnitOfMeasure: true },
    });
    const byId = new Map(items.map((i) => [i.id, i]));
    if (items.length !== itemIds.length) {
      throw new BadRequestException(
        'One or more lines reference an unknown item',
      );
    }
    const inactive = items.filter((i) => !i.isActive);
    if (inactive.length > 0) {
      throw new BadRequestException(
        'One or more lines reference an inactive item',
      );
    }
    return lines.map((l, i) => {
      const qty = new Prisma.Decimal(l.orderedQuantity);
      const price = new Prisma.Decimal(l.unitPrice);
      const item = l.itemId ? byId.get(l.itemId) : undefined;
      return {
        ...(l.itemId ? { item: { connect: { id: l.itemId } } } : {}),
        adHocItemName: l.adHocItemName?.trim() || null,
        adHocDescription: l.adHocDescription?.trim() || null,
        orderedQuantity: qty,
        unitPrice: price,
        unitOfMeasure: l.unitOfMeasure?.trim() || item?.baseUnitOfMeasure || '',
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
      adHocPartyName: po.adHocPartyName,
      adHocContactInfo: po.adHocContactInfo,
      adHocPartyAddress: po.adHocPartyAddress,
      ceoApprovedById: po.ceoApprovedById,
      ceoApprovedAt: po.ceoApprovedAt?.toISOString() ?? null,
      rejectedById: po.rejectedById,
      rejectedAt: po.rejectedAt?.toISOString() ?? null,
      rejectionComment: po.rejectionComment,
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
      lastEmailedAt: po.lastEmailedAt ? po.lastEmailedAt.toISOString() : null,
      lastEmailedTo: po.lastEmailedTo,
      partyEmail: po.supplier?.contactEmail ?? po.vendor?.contactEmail ?? null,
      totalAmount: total.toFixed(2),
      approvalAmount: po.approvalAmount?.toFixed(2) ?? null,
      advance: this.toAdvanceEntity(po, total),
      approvals: po.approvals.map((approval) => ({
        id: approval.id,
        level: approval.level,
        sequence: approval.sequence,
        status: approval.status,
        decidedById: approval.decidedById,
        decidedByName: approval.decidedBy
          ? `${approval.decidedBy.firstName} ${approval.decidedBy.lastName}`.trim()
          : null,
        decidedAt: approval.decidedAt?.toISOString() ?? null,
        comment: approval.comment,
      })),
      lines: po.lines.map(
        (l) =>
          new PurchaseOrderLineEntity({
            id: l.id,
            itemId: l.itemId,
            itemCode: l.item?.itemCode ?? null,
            itemName: l.item?.name ?? l.adHocItemName ?? 'Ad-hoc item',
            adHocDescription: l.adHocDescription,
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

  /**
   * The advance as the PO page needs it. Before issue there is no payment yet,
   * so the rupee figure is `indicativeAmount` — derived live, and labelled
   * differently precisely because it still moves when the lines are edited.
   * After issue it is `amount`, the frozen snapshot, and the payment's own
   * status is the single answer to "has the vendor been paid".
   */
  private toAdvanceEntity(
    po: PoWithRelations,
    total: Prisma.Decimal,
  ): PurchaseOrderAdvanceEntity | null {
    if (!po.advancePercent) return null;
    const request = po.advancePayments[0] ?? null;
    return new PurchaseOrderAdvanceEntity({
      percent: po.advancePercent.toFixed(2),
      amount: po.advanceAmount?.toFixed(2) ?? null,
      indicativeAmount: po.advanceAmount
        ? null
        : this.computeAdvanceAmount(total, po.advancePercent).toFixed(2),
      paymentId: request?.id ?? null,
      paymentNumber: request?.paymentNumber ?? null,
      status: request?.status ?? null,
      plannedDate: request?.plannedDate?.toISOString() ?? null,
      executedDate: request?.executedDate?.toISOString() ?? null,
      bankReference: request?.bankReference ?? null,
      rejectionComment: request?.rejectionComment ?? null,
    });
  }
}
