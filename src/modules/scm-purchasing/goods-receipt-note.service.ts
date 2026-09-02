import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  GoodsReceiptNoteStatus,
  NonConformanceReportStatus,
  PackingCondition,
  Prisma,
  PurchaseOrderStatus,
  StockBucket,
} from '@prisma/client';
import { PrismaService } from '../../core/database/prisma.service';
import { AuthenticatedUser } from '../../common/decorators/current-user.decorator';
import { SalesNumberingService } from '../sales/common/sales-numbering.service';
import { GrnAccessService } from './grn-access.service';
import {
  CreateGoodsReceiptNoteDto,
  FinalizeQcDto,
  GoodsReceiptNoteLineInputDto,
  UpdateGoodsReceiptNoteDto,
} from './dto/goods-receipt-note.dto';
import {
  GoodsReceiptNoteEntity,
  GoodsReceiptNoteLineEntity,
  GrnInspectionResponseEntity,
  GrnLineInspectionEntity,
  OverReceiptWarningEntity,
} from './entities/goods-receipt-note.entity';
import { NonConformanceReportEntity } from './entities/non-conformance-report.entity';
import { BomCostSnapshotService } from '../bom/bom-cost-snapshot.service';
import {
  ChecklistEvaluation,
  IncomingInspectionService,
  IncomingTemplate,
} from './incoming-inspection.service';

/** GRN statuses that count as "finalized" — their accepted qty is real stock. */
const FINALIZED: GoodsReceiptNoteStatus[] = [
  GoodsReceiptNoteStatus.QC_PASSED,
  GoodsReceiptNoteStatus.QC_PARTIAL,
  GoodsReceiptNoteStatus.QC_FAILED,
];

const GRN_INCLUDE = {
  purchaseOrder: { select: { poNumber: true } },
  receivedBy: { select: { firstName: true, lastName: true } },
  inspectedBy: { select: { firstName: true, lastName: true } },
  supervisorSignOff: { select: { firstName: true, lastName: true } },
  lines: {
    orderBy: { sequence: 'asc' as const },
    include: {
      item: { select: { itemCode: true, name: true } },
      storeLocation: { select: { name: true } },
      purchaseOrderLine: {
        select: { orderedQuantity: true, unitOfMeasure: true },
      },
    },
  },
  ncrs: {
    orderBy: { createdAt: 'asc' as const },
    include: {
      item: { select: { itemCode: true, name: true } },
      grn: { select: { grnNumber: true } },
      raisedBy: { select: { firstName: true, lastName: true } },
      dispositionedBy: { select: { firstName: true, lastName: true } },
    },
  },
} satisfies Prisma.GoodsReceiptNoteInclude;

type GrnWithRelations = Prisma.GoodsReceiptNoteGetPayload<{
  include: typeof GRN_INCLUDE;
}>;
type NcrWithRelations = GrnWithRelations['ncrs'][number];

/**
 * Goods Receipt Notes + the QC inspection gate (Stores Phase 2).
 *
 * THE CENTRAL RULE: receiving goods produces ZERO stock movement. A GRN is
 * created/submitted into PENDING_QC with nothing touching the stock ledger.
 * Only when a QC inspector finalizes the gate does the ACCEPTED quantity of
 * each line generate a STOCK_IN (a positive ON_HAND StockAdjustment + a
 * StockBalance increment, mirroring InventoryService.adjust but inlined into
 * the finalize transaction). Rejected quantity never enters stock and instead
 * spawns a NonConformanceReport.
 *
 * "Previously received" (cumulative accepted qty from earlier GRNs against the
 * same PO line) and the PO's PARTIALLY_RECEIVED / FULLY_RECEIVED status are
 * both computed from accepted quantities — never stored.
 */
@Injectable()
export class GoodsReceiptNoteService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: GrnAccessService,
    private readonly numbering: SalesNumberingService,
    private readonly inspections: IncomingInspectionService,
    private readonly costSnapshots?: BomCostSnapshotService,
  ) {}

  // ── Reads (company-wide) ─────────────────────────────────────────────
  /**
   * The approved incoming-inspection templates a QC inspector chooses from,
   * per line. Restricted to inspectors: this is the QC screen's reference data.
   */
  async inspectionTemplates(
    user: AuthenticatedUser,
  ): Promise<IncomingTemplate[]> {
    await this.access.assertCanInspect(user);
    return this.inspections.templates();
  }

  async list(
    user: AuthenticatedUser,
    opts: { status?: GoodsReceiptNoteStatus; purchaseOrderId?: string } = {},
  ): Promise<GoodsReceiptNoteEntity[]> {
    void user; // company-wide read
    const where: Prisma.GoodsReceiptNoteWhereInput = {};
    if (opts.status) where.status = opts.status;
    if (opts.purchaseOrderId) where.purchaseOrderId = opts.purchaseOrderId;
    const rows = await this.prisma.goodsReceiptNote.findMany({
      where,
      include: GRN_INCLUDE,
      orderBy: { createdAt: 'desc' },
    });
    return Promise.all(rows.map((r) => this.toEntity(r)));
  }

  async get(id: string): Promise<GoodsReceiptNoteEntity> {
    const row = await this.findOrThrow(id);
    return this.toEntity(row);
  }

  // ── Create / edit (Production-vertical) ──────────────────────────────
  async create(
    dto: CreateGoodsReceiptNoteDto,
    user: AuthenticatedUser,
  ): Promise<GoodsReceiptNoteEntity> {
    await this.access.assertCanReceiveGoods(user);
    const po = await this.loadPurchaseOrderForReceipt(dto.purchaseOrderId);
    const lines = this.buildLineData(dto.lines, po);

    const created = await this.prisma.$transaction(async (tx) => {
      const grnNumber = await this.numbering.nextNumber(
        'GRN',
        'goods_receipt_note',
        new Date().getUTCFullYear(),
        tx,
      );
      return tx.goodsReceiptNote.create({
        data: {
          grnNumber,
          status: GoodsReceiptNoteStatus.DRAFT,
          purchaseOrderId: dto.purchaseOrderId,
          receivedById: user.id,
          receivedDate: dto.receivedDate
            ? new Date(dto.receivedDate)
            : new Date(),
          notes: dto.notes ?? null,
          ...this.buildLogisticsData(dto),
          lines: { create: lines },
        },
      });
    });
    return this.get(created.id);
  }

  async update(
    id: string,
    dto: UpdateGoodsReceiptNoteDto,
    user: AuthenticatedUser,
  ): Promise<GoodsReceiptNoteEntity> {
    await this.access.assertCanReceiveGoods(user);
    const grn = await this.prisma.goodsReceiptNote.findUnique({
      where: { id },
    });
    if (!grn) throw new NotFoundException('Goods receipt note not found');
    if (grn.status !== GoodsReceiptNoteStatus.DRAFT) {
      throw new BadRequestException(
        `Only a DRAFT goods receipt note can be edited (current: ${grn.status})`,
      );
    }
    let lineData:
      Prisma.GoodsReceiptNoteLineCreateWithoutGrnInput[] | undefined;
    if (dto.lines) {
      const po = await this.loadPurchaseOrderForReceipt(grn.purchaseOrderId);
      lineData = this.buildLineData(dto.lines, po);
    }
    await this.prisma.goodsReceiptNote.update({
      where: { id },
      data: {
        ...(dto.receivedDate !== undefined
          ? {
              receivedDate: dto.receivedDate
                ? new Date(dto.receivedDate)
                : new Date(),
            }
          : {}),
        ...(dto.notes !== undefined ? { notes: dto.notes } : {}),
        ...this.buildLogisticsData(dto),
        ...(lineData ? { lines: { deleteMany: {}, create: lineData } } : {}),
      },
    });
    return this.get(id);
  }

  /**
   * Maps the shared logistics/sign-off DTO fields to Prisma column data. Only
   * keys present on the DTO are included, so an update leaves omitted fields
   * untouched. Empty strings normalise to null.
   */
  private buildLogisticsData(dto: {
    vendorDeliveryChallanNumber?: string;
    deliveryChallanDate?: string;
    vehicleOrAwbNumber?: string;
    driverOrCourier?: string;
    totalPackagesReceived?: number;
    packingCondition?: PackingCondition;
    supervisorSignOffId?: string;
  }): {
    vendorDeliveryChallanNumber?: string | null;
    deliveryChallanDate?: Date | null;
    vehicleOrAwbNumber?: string | null;
    driverOrCourier?: string | null;
    totalPackagesReceived?: number;
    packingCondition?: PackingCondition;
    supervisorSignOffId?: string | null;
  } {
    const data: {
      vendorDeliveryChallanNumber?: string | null;
      deliveryChallanDate?: Date | null;
      vehicleOrAwbNumber?: string | null;
      driverOrCourier?: string | null;
      totalPackagesReceived?: number;
      packingCondition?: PackingCondition;
      supervisorSignOffId?: string | null;
    } = {};
    if (dto.vendorDeliveryChallanNumber !== undefined)
      data.vendorDeliveryChallanNumber =
        dto.vendorDeliveryChallanNumber || null;
    if (dto.deliveryChallanDate !== undefined)
      data.deliveryChallanDate = dto.deliveryChallanDate
        ? new Date(dto.deliveryChallanDate)
        : null;
    if (dto.vehicleOrAwbNumber !== undefined)
      data.vehicleOrAwbNumber = dto.vehicleOrAwbNumber || null;
    if (dto.driverOrCourier !== undefined)
      data.driverOrCourier = dto.driverOrCourier || null;
    if (dto.totalPackagesReceived !== undefined)
      data.totalPackagesReceived = dto.totalPackagesReceived;
    if (dto.packingCondition !== undefined)
      data.packingCondition = dto.packingCondition;
    if (dto.supervisorSignOffId !== undefined)
      data.supervisorSignOffId = dto.supervisorSignOffId || null;
    return data;
  }

  /** DRAFT → PENDING_QC. Still ZERO stock movement — QC is a separate step. */
  async submit(
    id: string,
    user: AuthenticatedUser,
  ): Promise<GoodsReceiptNoteEntity> {
    await this.access.assertCanReceiveGoods(user);
    const grn = await this.prisma.goodsReceiptNote.findUnique({
      where: { id },
    });
    if (!grn) throw new NotFoundException('Goods receipt note not found');
    if (grn.status !== GoodsReceiptNoteStatus.DRAFT) {
      throw new BadRequestException(
        `Only a DRAFT goods receipt note can be submitted for QC (current: ${grn.status})`,
      );
    }
    await this.prisma.goodsReceiptNote.update({
      where: { id },
      data: { status: GoodsReceiptNoteStatus.PENDING_QC },
    });
    return this.get(id);
  }

  /** Cancel a DRAFT or PENDING_QC GRN (no stock was ever moved). */
  async cancel(
    id: string,
    user: AuthenticatedUser,
  ): Promise<GoodsReceiptNoteEntity> {
    await this.access.assertCanReceiveGoods(user);
    const grn = await this.prisma.goodsReceiptNote.findUnique({
      where: { id },
    });
    if (!grn) throw new NotFoundException('Goods receipt note not found');
    if (
      grn.status !== GoodsReceiptNoteStatus.DRAFT &&
      grn.status !== GoodsReceiptNoteStatus.PENDING_QC
    ) {
      throw new BadRequestException(
        `Only a DRAFT or PENDING_QC goods receipt note can be cancelled (current: ${grn.status})`,
      );
    }
    await this.prisma.goodsReceiptNote.update({
      where: { id },
      data: { status: GoodsReceiptNoteStatus.CANCELLED },
    });
    return this.get(id);
  }

  // ── QC finalization (QC Inspector / SA) ──────────────────────────────
  /**
   * Finalize the QC gate. This is the ONLY path that moves stock.
   *
   * Every line is inspected against an APPROVED incoming question template, and
   * the checklist result DRIVES the quantities: a failed checklist cannot accept
   * the whole lot, and a passed checklist cannot reject any of it. Then, per
   * line: accepted qty → STOCK_IN (ON_HAND +accepted), rejected qty → an OPEN
   * NonConformanceReport, and the answers → a terminal QmsInspection. The GRN
   * status settles to QC_PASSED / QC_PARTIAL / QC_FAILED, and the parent PO's
   * receipt status is re-derived.
   */
  async finalizeQc(
    id: string,
    dto: FinalizeQcDto,
    user: AuthenticatedUser,
  ): Promise<GoodsReceiptNoteEntity> {
    await this.access.assertCanInspect(user);
    const grn = await this.findOrThrow(id);
    if (grn.status !== GoodsReceiptNoteStatus.PENDING_QC) {
      throw new BadRequestException(
        `Only a PENDING_QC goods receipt note can be QC-finalized (current: ${grn.status})`,
      );
    }

    // Map decisions by line id and validate they exactly cover the GRN lines.
    const decisionByLine = new Map(dto.lines.map((l) => [l.grnLineId, l]));
    if (decisionByLine.size !== dto.lines.length) {
      throw new BadRequestException('Duplicate grnLineId in QC decisions');
    }
    const grnLineIds = new Set(grn.lines.map((l) => l.id));
    for (const d of dto.lines) {
      if (!grnLineIds.has(d.grnLineId)) {
        throw new BadRequestException(
          `QC decision references a line (${d.grnLineId}) not on this GRN`,
        );
      }
    }
    if (dto.lines.length !== grn.lines.length) {
      throw new BadRequestException(
        'Every GRN line must have a QC decision (accepted + rejected)',
      );
    }

    // Every line is inspected against an approved INCOMING template. Loaded up
    // front so a bad template id fails before any quantity is validated.
    const templates = await this.inspections.loadTemplates(
      dto.lines.map((l) => l.templateId),
    );

    // Validate each decision: the checklist first, then that the quantities it
    // implies are the quantities being claimed.
    const evaluations = new Map<string, ChecklistEvaluation>();
    for (const line of grn.lines) {
      const d = decisionByLine.get(line.id)!;
      const label = `${line.item.itemCode}`;
      const accepted = new Prisma.Decimal(d.acceptedQuantity);
      const rejected = new Prisma.Decimal(d.rejectedQuantity);
      if (!accepted.plus(rejected).equals(line.receivedQuantity)) {
        throw new BadRequestException(
          `Line ${line.id}: accepted (${accepted}) + rejected (${rejected}) must equal received (${line.receivedQuantity})`,
        );
      }
      if (rejected.greaterThan(0) && !d.rejectionReason?.trim()) {
        throw new BadRequestException(
          `Line ${line.id}: a rejection reason is required when any quantity is rejected`,
        );
      }

      const evaluation = this.inspections.evaluate(
        templates.get(d.templateId)!,
        d.responses,
        label,
      );
      evaluations.set(line.id, evaluation);

      // The checklist is the basis of the decision, so the two cannot disagree.
      // Accepting a lot whose inspection failed, or rejecting one whose
      // inspection passed, would leave the record contradicting the outcome.
      if (evaluation.result === 'FAIL' && rejected.equals(0)) {
        throw new BadRequestException(
          `${label}: the inspection failed (${evaluation.failedPrompts.join('; ')}) — the whole quantity cannot be accepted. Reject the non-conforming quantity, or correct the checklist.`,
        );
      }
      if (evaluation.result === 'PASS' && rejected.greaterThan(0)) {
        throw new BadRequestException(
          `${label}: the inspection passed, so no quantity can be rejected. Record the failing observation on the checklist first.`,
        );
      }
    }

    const totals = grn.lines.reduce(
      (acc, line) => {
        const d = decisionByLine.get(line.id)!;
        return {
          accepted: acc.accepted.plus(d.acceptedQuantity),
          rejected: acc.rejected.plus(d.rejectedQuantity),
        };
      },
      { accepted: new Prisma.Decimal(0), rejected: new Prisma.Decimal(0) },
    );
    const nextStatus = totals.rejected.equals(0)
      ? GoodsReceiptNoteStatus.QC_PASSED
      : totals.accepted.equals(0)
        ? GoodsReceiptNoteStatus.QC_FAILED
        : GoodsReceiptNoteStatus.QC_PARTIAL;

    const year = new Date().getUTCFullYear();
    const now = new Date();

    await this.prisma.$transaction(async (tx) => {
      for (const line of grn.lines) {
        const d = decisionByLine.get(line.id)!;
        const accepted = new Prisma.Decimal(d.acceptedQuantity);
        const rejected = new Prisma.Decimal(d.rejectedQuantity);

        await tx.goodsReceiptNoteLine.update({
          where: { id: line.id },
          data: {
            acceptedQuantity: accepted,
            rejectedQuantity: rejected,
            rejectionReason: d.rejectionReason?.trim() || null,
          },
        });

        // The inspection record — created in the same transaction as the stock
        // movement it authorised, so stock can never exist without the
        // inspection that let it in.
        await this.inspections.createForGrnLine(tx, {
          template: templates.get(d.templateId)!,
          evaluation: evaluations.get(line.id)!,
          grnId: grn.id,
          grnLineId: line.id,
          grnNumber: grn.grnNumber,
          receivedQuantity: line.receivedQuantity,
          acceptedQuantity: accepted,
          rejectedQuantity: rejected,
          remarks: d.remarks,
          inspectorId: user.id,
          inspectedAt: now,
        });

        // Accepted quantity → STOCK_IN (mirror InventoryService.adjust inline).
        if (accepted.greaterThan(0)) {
          const balance = await tx.stockBalance.upsert({
            where: {
              itemId_storeLocationId: {
                itemId: line.itemId,
                storeLocationId: line.storeLocationId,
              },
            },
            create: {
              itemId: line.itemId,
              storeLocationId: line.storeLocationId,
            },
            update: {},
          });
          await tx.stockBalance.update({
            where: { id: balance.id },
            data: { onHandQuantity: balance.onHandQuantity.plus(accepted) },
          });
          await tx.stockAdjustment.create({
            data: {
              itemId: line.itemId,
              storeLocationId: line.storeLocationId,
              bucket: StockBucket.ON_HAND,
              quantityChange: accepted,
              reason: `GRN ${grn.grnNumber} QC-accepted receipt`,
              actorId: user.id,
            },
          });
        }

        // Rejected quantity → an OPEN NCR (never enters stock).
        if (rejected.greaterThan(0)) {
          const ncrNumber = await this.numbering.nextNumber(
            'NCR',
            'non_conformance_report',
            year,
            tx,
          );
          await tx.nonConformanceReport.create({
            data: {
              ncrNumber,
              status: NonConformanceReportStatus.OPEN,
              grnId: grn.id,
              grnLineId: line.id,
              itemId: line.itemId,
              rejectedQuantity: rejected,
              rejectionReason: d.rejectionReason?.trim() || null,
              raisedById: user.id,
            },
          });
        }
      }

      await tx.goodsReceiptNote.update({
        where: { id: grn.id },
        data: {
          status: nextStatus,
          inspectedById: user.id,
          inspectedAt: now,
        },
      });

      // Re-derive the parent PO's receipt status from cumulative accepted qty.
      await this.derivePurchaseOrderStatus(tx, grn.purchaseOrderId);
    });

    if (totals.accepted.greaterThan(0)) {
      await this.costSnapshots?.refreshReleasedSnapshots();
    }

    const entity = await this.get(id);
    entity.overReceiptWarnings = await this.computeOverReceiptWarnings(
      grn.purchaseOrderId,
    );
    return entity;
  }

  // ── Helpers ──────────────────────────────────────────────────────────
  private async findOrThrow(id: string): Promise<GrnWithRelations> {
    const row = await this.prisma.goodsReceiptNote.findUnique({
      where: { id },
      include: GRN_INCLUDE,
    });
    if (!row) throw new NotFoundException('Goods receipt note not found');
    return row;
  }

  private async loadPurchaseOrderForReceipt(purchaseOrderId: string) {
    const po = await this.prisma.purchaseOrder.findUnique({
      where: { id: purchaseOrderId },
      include: {
        lines: {
          where: { itemId: { not: null } },
          select: { id: true, itemId: true },
        },
      },
    });
    if (!po) throw new NotFoundException('Purchase order not found');
    if (
      po.status !== PurchaseOrderStatus.ISSUED &&
      po.status !== PurchaseOrderStatus.PARTIALLY_RECEIVED
    ) {
      throw new BadRequestException(
        'Cannot receive against a purchase order until it is fully approved and issued',
      );
    }
    return po;
  }

  private buildLineData(
    lines: GoodsReceiptNoteLineInputDto[],
    po: { id: string; lines: { id: string; itemId: string | null }[] },
  ): Prisma.GoodsReceiptNoteLineCreateWithoutGrnInput[] {
    const poLineById = new Map(po.lines.map((l) => [l.id, l]));
    return lines.map((l, i) => {
      const poLine = poLineById.get(l.purchaseOrderLineId);
      if (!poLine) {
        throw new BadRequestException(
          `Line references a purchase order line (${l.purchaseOrderLineId}) not on purchase order ${po.id}`,
        );
      }
      if (!poLine.itemId) {
        throw new BadRequestException(
          'Free-text purchase order lines are non-inventory lines and cannot be received into stock',
        );
      }
      return {
        purchaseOrderLine: { connect: { id: poLine.id } },
        item: { connect: { id: poLine.itemId } },
        storeLocation: { connect: { id: l.storeLocationId } },
        receivedQuantity: new Prisma.Decimal(l.receivedQuantity),
        sequence: l.sequence ?? i,
      };
    });
  }

  /**
   * Cumulative accepted quantity per PO line across ALL finalized GRNs. Used
   * for PO status derivation and over-receipt warnings.
   */
  private async cumulativeAcceptedByPoLine(
    tx: Prisma.TransactionClient | PrismaService,
    purchaseOrderId: string,
  ): Promise<Map<string, Prisma.Decimal>> {
    const rows = await tx.goodsReceiptNoteLine.findMany({
      where: {
        grn: {
          purchaseOrderId,
          status: { in: FINALIZED },
        },
        acceptedQuantity: { not: null },
      },
      select: { purchaseOrderLineId: true, acceptedQuantity: true },
    });
    const acc = new Map<string, Prisma.Decimal>();
    for (const r of rows) {
      const prev = acc.get(r.purchaseOrderLineId) ?? new Prisma.Decimal(0);
      acc.set(r.purchaseOrderLineId, prev.plus(r.acceptedQuantity ?? 0));
    }
    return acc;
  }

  private async derivePurchaseOrderStatus(
    tx: Prisma.TransactionClient,
    purchaseOrderId: string,
  ): Promise<void> {
    const po = await tx.purchaseOrder.findUnique({
      where: { id: purchaseOrderId },
      include: {
        lines: {
          where: { itemId: { not: null } },
          select: { id: true, orderedQuantity: true },
        },
      },
    });
    if (!po) return;
    // Never override a terminal/administrative state.
    if (
      po.status === PurchaseOrderStatus.CANCELLED ||
      po.status === PurchaseOrderStatus.DRAFT
    ) {
      return;
    }
    const accepted = await this.cumulativeAcceptedByPoLine(tx, purchaseOrderId);
    let anyReceived = false;
    let allFull = po.lines.length > 0;
    for (const line of po.lines) {
      const got = accepted.get(line.id) ?? new Prisma.Decimal(0);
      if (got.greaterThan(0)) anyReceived = true;
      if (got.lessThan(line.orderedQuantity)) allFull = false;
    }
    const derived = allFull
      ? PurchaseOrderStatus.FULLY_RECEIVED
      : anyReceived
        ? PurchaseOrderStatus.PARTIALLY_RECEIVED
        : PurchaseOrderStatus.ISSUED;
    if (derived !== po.status) {
      await tx.purchaseOrder.update({
        where: { id: po.id },
        data: { status: derived },
      });
    }
  }

  private async computeOverReceiptWarnings(
    purchaseOrderId: string,
  ): Promise<OverReceiptWarningEntity[]> {
    const po = await this.prisma.purchaseOrder.findUnique({
      where: { id: purchaseOrderId },
      include: {
        lines: {
          select: {
            id: true,
            orderedQuantity: true,
            item: { select: { itemCode: true } },
          },
        },
      },
    });
    if (!po) return [];
    const accepted = await this.cumulativeAcceptedByPoLine(
      this.prisma,
      purchaseOrderId,
    );
    const warnings: OverReceiptWarningEntity[] = [];
    for (const line of po.lines) {
      const got = accepted.get(line.id) ?? new Prisma.Decimal(0);
      if (line.item && got.greaterThan(line.orderedQuantity)) {
        warnings.push(
          new OverReceiptWarningEntity({
            purchaseOrderLineId: line.id,
            itemCode: line.item.itemCode,
            orderedQuantity: line.orderedQuantity.toString(),
            cumulativeAccepted: got.toString(),
            message: `Over-receipt: ${got} accepted against ${line.orderedQuantity} ordered for ${line.item.itemCode}.`,
          }),
        );
      }
    }
    return warnings;
  }

  private async toEntity(
    grn: GrnWithRelations,
  ): Promise<GoodsReceiptNoteEntity> {
    // "Previously received" per PO line = cumulative accepted qty from OTHER
    // finalized GRNs created before this one. Computed on read.
    const poLineIds = [...new Set(grn.lines.map((l) => l.purchaseOrderLineId))];
    const priorLines = poLineIds.length
      ? await this.prisma.goodsReceiptNoteLine.findMany({
          where: {
            purchaseOrderLineId: { in: poLineIds },
            grnId: { not: grn.id },
            acceptedQuantity: { not: null },
            grn: {
              status: { in: FINALIZED },
              createdAt: { lt: grn.createdAt },
            },
          },
          select: { purchaseOrderLineId: true, acceptedQuantity: true },
        })
      : [];
    const priorByPoLine = new Map<string, Prisma.Decimal>();
    for (const r of priorLines) {
      const prev =
        priorByPoLine.get(r.purchaseOrderLineId) ?? new Prisma.Decimal(0);
      priorByPoLine.set(
        r.purchaseOrderLineId,
        prev.plus(r.acceptedQuantity ?? 0),
      );
    }

    const inspectionByLine = await this.inspectionsByLine(grn.id);

    return new GoodsReceiptNoteEntity({
      id: grn.id,
      grnNumber: grn.grnNumber,
      status: grn.status,
      purchaseOrderId: grn.purchaseOrderId,
      poNumber: grn.purchaseOrder?.poNumber ?? null,
      receivedById: grn.receivedById,
      receivedByName: grn.receivedBy
        ? `${grn.receivedBy.firstName} ${grn.receivedBy.lastName}`.trim()
        : null,
      receivedDate: grn.receivedDate.toISOString(),
      inspectedById: grn.inspectedById,
      inspectedByName: grn.inspectedBy
        ? `${grn.inspectedBy.firstName} ${grn.inspectedBy.lastName}`.trim()
        : null,
      inspectedAt: grn.inspectedAt ? grn.inspectedAt.toISOString() : null,
      vendorDeliveryChallanNumber: grn.vendorDeliveryChallanNumber,
      deliveryChallanDate: grn.deliveryChallanDate
        ? grn.deliveryChallanDate.toISOString()
        : null,
      vehicleOrAwbNumber: grn.vehicleOrAwbNumber,
      driverOrCourier: grn.driverOrCourier,
      totalPackagesReceived: grn.totalPackagesReceived,
      packingCondition: grn.packingCondition,
      supervisorSignOffId: grn.supervisorSignOffId,
      supervisorSignOffName: grn.supervisorSignOff
        ? `${grn.supervisorSignOff.firstName} ${grn.supervisorSignOff.lastName}`.trim()
        : null,
      notes: grn.notes,
      lines: grn.lines.map(
        (l) =>
          new GoodsReceiptNoteLineEntity({
            id: l.id,
            purchaseOrderLineId: l.purchaseOrderLineId,
            itemId: l.itemId,
            itemCode: l.item.itemCode,
            itemName: l.item.name,
            storeLocationId: l.storeLocationId,
            storeLocationName: l.storeLocation.name,
            orderedQuantity: l.purchaseOrderLine.orderedQuantity.toString(),
            receivedQuantity: l.receivedQuantity.toString(),
            acceptedQuantity:
              l.acceptedQuantity !== null
                ? l.acceptedQuantity.toString()
                : null,
            rejectedQuantity:
              l.rejectedQuantity !== null
                ? l.rejectedQuantity.toString()
                : null,
            rejectionReason: l.rejectionReason,
            previouslyReceived: (
              priorByPoLine.get(l.purchaseOrderLineId) ?? new Prisma.Decimal(0)
            ).toString(),
            unitOfMeasure: l.purchaseOrderLine.unitOfMeasure,
            sequence: l.sequence,
            inspection: inspectionByLine.get(l.id) ?? null,
          }),
      ),
      ncrs: grn.ncrs.map((n) => this.ncrToEntity(n)),
      createdAt: grn.createdAt.toISOString(),
      updatedAt: grn.updatedAt.toISOString(),
    });
  }

  /**
   * The incoming inspection recorded against each line of one GRN, keyed by
   * grnLineId. One query per GRN (qms_inspections is indexed on grnId) — the
   * QMS tables carry no FK into Stores, so this cannot be a Prisma include.
   */
  private async inspectionsByLine(
    grnId: string,
  ): Promise<Map<string, GrnLineInspectionEntity>> {
    const rows = await this.prisma.qmsInspection.findMany({
      where: { grnId, grnLineId: { not: null } },
      include: { responses: { orderBy: { sequence: 'asc' } } },
      orderBy: { createdAt: 'asc' },
    });
    const byLine = new Map<string, GrnLineInspectionEntity>();
    for (const r of rows) {
      const snapshot = (r.templateSnapshot ?? {}) as {
        templateCode?: string;
        name?: string;
        version?: number;
      };
      // A line inspected more than once (a re-inspection) shows the latest.
      byLine.set(
        r.grnLineId!,
        new GrnLineInspectionEntity({
          id: r.id,
          inspectionNumber: r.inspectionNumber,
          status: r.status,
          overallResult: r.overallResult,
          templateCode: snapshot.templateCode ?? null,
          templateName: snapshot.name ?? null,
          templateVersion: snapshot.version ?? null,
          inspectedAt: r.inspectedAt ? r.inspectedAt.toISOString() : null,
          remarks: r.remarks,
          responses: r.responses.map(
            (q) =>
              new GrnInspectionResponseEntity({
                questionKey: q.questionKey,
                section: q.section,
                sequence: q.sequence,
                prompt: q.promptSnapshot,
                responseType: q.responseType,
                required: q.required,
                answer:
                  q.answer &&
                  typeof q.answer === 'object' &&
                  'value' in q.answer
                    ? String((q.answer as { value: unknown }).value ?? '')
                    : null,
                result: q.result,
                comments: q.comments,
              }),
          ),
        }),
      );
    }
    return byLine;
  }

  private ncrToEntity(n: NcrWithRelations): NonConformanceReportEntity {
    return new NonConformanceReportEntity({
      id: n.id,
      ncrNumber: n.ncrNumber,
      status: n.status,
      grnId: n.grnId,
      grnNumber: n.grn?.grnNumber ?? null,
      grnLineId: n.grnLineId,
      itemId: n.itemId,
      itemCode: n.item?.itemCode ?? null,
      itemName: n.item?.name ?? null,
      rejectedQuantity: n.rejectedQuantity.toString(),
      rejectionReason: n.rejectionReason,
      disposition: n.disposition,
      dispositionNotes: n.dispositionNotes,
      raisedById: n.raisedById,
      raisedByName: n.raisedBy
        ? `${n.raisedBy.firstName} ${n.raisedBy.lastName}`.trim()
        : null,
      dispositionedById: n.dispositionedById,
      dispositionedByName: n.dispositionedBy
        ? `${n.dispositionedBy.firstName} ${n.dispositionedBy.lastName}`.trim()
        : null,
      dispositionedAt: n.dispositionedAt
        ? n.dispositionedAt.toISOString()
        : null,
      createdAt: n.createdAt.toISOString(),
      updatedAt: n.updatedAt.toISOString(),
    });
  }
}
