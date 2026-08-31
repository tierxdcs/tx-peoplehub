import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  DeliveryChallanStatus,
  OrderFinalQcStatus,
  OrderFulfilmentStatus,
  OrderLineDeliveryType,
  OrderStatus,
  PlmStage,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../../core/database/prisma.service';
import { AuthenticatedUser } from '../../common/decorators/current-user.decorator';
import { SalesNumberingService } from '../sales/common/sales-numbering.service';
import { InventoryService } from '../bom/inventory.service';
import { ArService } from '../finance-ar/ar.service';
import { VaultStorageService } from '../vault/vault-storage.service';
import { PushEventsService } from '../notifications/push-events.service';
import {
  assertExtensionAllowed,
  assertSizeWithinCap,
} from '../vault/vault-guardrails';
import { DispatchAccessService } from './dispatch-access.service';
import {
  ConfirmPodDto,
  CreateDeliveryChallanDto,
  DeliveryChallanLineInputDto,
  EwayBillDto,
  UpdateDeliveryChallanDto,
} from './dto/delivery-challan.dto';
import {
  DeliveryChallanEntity,
  DeliveryChallanLineEntity,
  OverDispatchWarningEntity,
} from './entities/delivery-challan.entity';

/** DC statuses that count toward fulfilment / previously-dispatched (not cancelled). */
const ACTIVE_DC: DeliveryChallanStatus[] = [
  DeliveryChallanStatus.DISPATCHED,
  DeliveryChallanStatus.IN_TRANSIT,
  DeliveryChallanStatus.DELIVERED,
];

type DispatchOrderLineFlow = {
  deliveryType: OrderLineDeliveryType | null;
  deliverySplits: Array<{ deliveryType: OrderLineDeliveryType | null }>;
};

/**
 * Vendor-only lines are fulfilled outside company inventory. Unclassified,
 * NPD, IN_HOUSE, and mixed-flow lines retain the stock ledger safeguard.
 */
export function requiresInternalDispatchStock(
  orderLine: DispatchOrderLineFlow,
): boolean {
  if (orderLine.deliverySplits.length > 0) {
    return orderLine.deliverySplits.some(
      (split) => split.deliveryType !== OrderLineDeliveryType.VENDOR,
    );
  }
  return orderLine.deliveryType !== OrderLineDeliveryType.VENDOR;
}

const DC_INCLUDE = {
  order: { select: { orderNumber: true } },
  customer: { select: { name: true } },
  createdBy: { select: { firstName: true, lastName: true } },
  linkedInvoice: { select: { invoiceNumber: true, status: true } },
  lines: {
    orderBy: { sequence: 'asc' as const },
    include: {
      item: { select: { itemCode: true } },
      orderLine: {
        select: {
          quantity: true,
          deliveryType: true,
          deliverySplits: { select: { deliveryType: true } },
        },
      },
    },
  },
} satisfies Prisma.DeliveryChallanInclude;

type DcWithRelations = Prisma.DeliveryChallanGetPayload<{
  include: typeof DC_INCLUDE;
}>;

/**
 * Logistics & Dispatch. Delivery Challans for outbound shipments.
 *
 * Dispatching a DC (DRAFT → DISPATCHED) does two integrations, atomically:
 *  1. STOCK_OUT for internally fulfilled lines via the shared InventoryService
 *     ledger. Vendor-only lines bypass company inventory because those goods
 *     are dispatched by the assigned vendor rather than from an internal store.
 *  2. Seeds a DRAFT SalesInvoice in AR via ArService.createDraftInvoiceFromDispatch
 *     — DRAFT only, never issued; Finance's maker-checker owns the rest.
 *
 * Partial dispatch across multiple DCs is supported; "previously dispatched"
 * and Order.fulfilmentStatus are COMPUTED from DC data, never stored counters.
 * A dispatch is gated on the Order's outbound final-QC clearance.
 */
@Injectable()
export class DeliveryChallanService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: DispatchAccessService,
    private readonly numbering: SalesNumberingService,
    private readonly inventory: InventoryService,
    private readonly ar: ArService,
    private readonly storage: VaultStorageService,
    // PushEventsModule is @Global, so this needs no import edge here.
    private readonly pushEvents: PushEventsService,
  ) {}

  // ── Reads (company-wide) ─────────────────────────────────────────────
  async list(
    user: AuthenticatedUser,
    opts: { status?: DeliveryChallanStatus; orderId?: string } = {},
  ): Promise<DeliveryChallanEntity[]> {
    void user;
    const where: Prisma.DeliveryChallanWhereInput = {};
    if (opts.status) where.status = opts.status;
    if (opts.orderId) where.orderId = opts.orderId;
    const rows = await this.prisma.deliveryChallan.findMany({
      where,
      include: DC_INCLUDE,
      orderBy: { createdAt: 'desc' },
    });
    return Promise.all(rows.map((r) => this.toEntity(r)));
  }

  async get(id: string): Promise<DeliveryChallanEntity> {
    return this.toEntity(await this.findOrThrow(id));
  }

  /**
   * Purpose-built picker read. Sales /orders remains commercially scoped;
   * Quality receives only the operational fields needed for outbound QC.
   */
  async eligibleOrders(user: AuthenticatedUser) {
    await this.access.assertCanViewDispatchOrders(user);
    const orders = await this.prisma.order.findMany({
      where: {
        status: { not: OrderStatus.CANCELLED },
        fulfilmentStatus: { not: OrderFulfilmentStatus.FULLY_DISPATCHED },
        OR: [
          {
            status: {
              in: [
                OrderStatus.READY_TO_SHIP,
                OrderStatus.SHIPPED,
                OrderStatus.DELIVERED,
              ],
            },
          },
          {
            lineItems: {
              some: {
                plmTrackers: {
                  some: {
                    currentStage: {
                      in: [PlmStage.DISPATCH, PlmStage.COMPLETED],
                    },
                  },
                },
              },
            },
          },
        ],
      },
      select: {
        id: true,
        orderNumber: true,
        status: true,
        fulfilmentStatus: true,
        finalQcStatus: true,
        lineItems: {
          orderBy: { createdAt: 'asc' },
          select: {
            id: true,
            quantity: true,
            productId: true,
            adHocProductName: true,
            customerFacingProductName: true,
            product: { select: { name: true, sku: true } },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
    return orders.map((order) => ({
      ...order,
      dispatchReady: true,
      lineItems: order.lineItems.map((line) => ({
        ...line,
        quantity: line.quantity.toString(),
        // Challans are customer-facing — the line's override wording first.
        productName:
          line.customerFacingProductName ??
          line.product?.name ??
          line.adHocProductName ??
          'Unnamed product',
        productSku: line.product?.sku ?? 'Ad-hoc',
      })),
    }));
  }

  // ── Outbound final-QC clearance (the dispatch gate) ──────────────────
  async clearFinalQc(orderId: string, user: AuthenticatedUser) {
    await this.access.assertCanClearFinalQc(user);
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
    });
    if (!order) throw new NotFoundException('Order not found');
    if (order.finalQcStatus === OrderFinalQcStatus.CLEARED) {
      // Idempotent success: a stale client may still display PENDING after a
      // previous request succeeded. Returning the current state lets it reload
      // instead of trapping the user behind an "already cleared" error.
      return { orderId, finalQcStatus: OrderFinalQcStatus.CLEARED };
    }
    await this.prisma.order.update({
      where: { id: orderId },
      data: {
        finalQcStatus: OrderFinalQcStatus.CLEARED,
        finalQcClearedById: user.id,
        finalQcClearedAt: new Date(),
      },
    });
    // Below the idempotent early-return above, so a stale client retrying a
    // clearance that already succeeded does not push a second time. Final QC is
    // the last gate before shipping, so this is the order owner's cue to act.
    void this.pushEvents.orderReadyToDispatch({ orderId, actorId: user.id });
    return { orderId, finalQcStatus: OrderFinalQcStatus.CLEARED };
  }

  // ── Create / edit (DRAFT) ────────────────────────────────────────────
  async create(
    dto: CreateDeliveryChallanDto,
    user: AuthenticatedUser,
  ): Promise<DeliveryChallanEntity> {
    await this.access.assertCanDispatch(user);
    const order = await this.loadOrderForDispatch(dto.orderId);
    // A delivery challan is a customer-facing document keyed to a Customer.
    // An internal order with no (prospective) customer has no billing party to
    // raise it against — set a customer or promote the order first.
    if (!order.customerId) {
      throw new BadRequestException(
        'This order has no customer on record — add a customer, or promote the internal order, before raising a delivery challan',
      );
    }
    const customerId = order.customerId;
    const lineData = await this.buildLineData(dto.lines, order);

    const created = await this.prisma.$transaction(async (tx) => {
      const dcNumber = await this.numbering.nextNumber(
        'DC',
        'delivery_challan',
        (dto.dispatchDate
          ? new Date(dto.dispatchDate)
          : new Date()
        ).getUTCFullYear(),
        tx,
      );
      return tx.deliveryChallan.create({
        data: {
          dcNumber,
          status: DeliveryChallanStatus.DRAFT,
          orderId: order.id,
          customerId,
          customerPoReference: dto.customerPoReference ?? null,
          dispatchDate: dto.dispatchDate
            ? new Date(dto.dispatchDate)
            : new Date(),
          consigneeName: dto.consigneeName,
          consigneeAddress: dto.consigneeAddress,
          consigneeGstin: dto.consigneeGstin ?? null,
          consigneeStateCode: dto.consigneeStateCode,
          transportMode: dto.transportMode,
          transporterName: dto.transporterName ?? null,
          vehicleOrAwbNumber: dto.vehicleOrAwbNumber ?? null,
          driverName: dto.driverName ?? null,
          driverPhone: dto.driverPhone ?? null,
          specialDeliveryInstructions: dto.specialDeliveryInstructions ?? null,
          documentsIncluded: (dto.documentsIncluded ?? undefined) as
            Prisma.InputJsonValue | undefined,
          promisedDeliveryDate: dto.promisedDeliveryDate
            ? new Date(dto.promisedDeliveryDate)
            : null,
          createdById: user.id,
          lines: { create: lineData },
        },
      });
    });
    const entity = await this.get(created.id);
    entity.overDispatchWarnings = await this.computeOverDispatchWarnings(
      order.id,
    );
    return entity;
  }

  async update(
    id: string,
    dto: UpdateDeliveryChallanDto,
    user: AuthenticatedUser,
  ): Promise<DeliveryChallanEntity> {
    await this.access.assertCanDispatch(user);
    const dc = await this.prisma.deliveryChallan.findUnique({ where: { id } });
    if (!dc) throw new NotFoundException('Delivery challan not found');
    if (dc.status !== DeliveryChallanStatus.DRAFT) {
      throw new BadRequestException(
        `Only a DRAFT delivery challan can be edited (current: ${dc.status})`,
      );
    }
    let lineData:
      Prisma.DeliveryChallanLineCreateWithoutDeliveryChallanInput[] | undefined;
    if (dto.lines) {
      const order = await this.loadOrderForDispatch(dc.orderId);
      lineData = await this.buildLineData(dto.lines, order);
    }
    await this.prisma.deliveryChallan.update({
      where: { id },
      data: {
        ...(dto.dispatchDate !== undefined
          ? {
              dispatchDate: dto.dispatchDate
                ? new Date(dto.dispatchDate)
                : new Date(),
            }
          : {}),
        ...(dto.customerPoReference !== undefined
          ? { customerPoReference: dto.customerPoReference || null }
          : {}),
        ...(dto.consigneeName !== undefined
          ? { consigneeName: dto.consigneeName }
          : {}),
        ...(dto.consigneeAddress !== undefined
          ? { consigneeAddress: dto.consigneeAddress }
          : {}),
        ...(dto.consigneeGstin !== undefined
          ? { consigneeGstin: dto.consigneeGstin || null }
          : {}),
        ...(dto.consigneeStateCode !== undefined
          ? { consigneeStateCode: dto.consigneeStateCode }
          : {}),
        ...(dto.transportMode !== undefined
          ? { transportMode: dto.transportMode }
          : {}),
        ...(dto.transporterName !== undefined
          ? { transporterName: dto.transporterName || null }
          : {}),
        ...(dto.vehicleOrAwbNumber !== undefined
          ? { vehicleOrAwbNumber: dto.vehicleOrAwbNumber || null }
          : {}),
        ...(dto.driverName !== undefined
          ? { driverName: dto.driverName || null }
          : {}),
        ...(dto.driverPhone !== undefined
          ? { driverPhone: dto.driverPhone || null }
          : {}),
        ...(dto.specialDeliveryInstructions !== undefined
          ? {
              specialDeliveryInstructions:
                dto.specialDeliveryInstructions || null,
            }
          : {}),
        ...(dto.documentsIncluded !== undefined
          ? {
              documentsIncluded: dto.documentsIncluded as Prisma.InputJsonValue,
            }
          : {}),
        ...(dto.promisedDeliveryDate !== undefined
          ? {
              promisedDeliveryDate: dto.promisedDeliveryDate
                ? new Date(dto.promisedDeliveryDate)
                : null,
            }
          : {}),
        ...(lineData ? { lines: { deleteMany: {}, create: lineData } } : {}),
      },
    });
    const entity = await this.get(id);
    entity.overDispatchWarnings = await this.computeOverDispatchWarnings(
      dc.orderId,
    );
    return entity;
  }

  async cancel(
    id: string,
    user: AuthenticatedUser,
  ): Promise<DeliveryChallanEntity> {
    await this.access.assertCanDispatch(user);
    const dc = await this.prisma.deliveryChallan.findUnique({ where: { id } });
    if (!dc) throw new NotFoundException('Delivery challan not found');
    if (dc.status !== DeliveryChallanStatus.DRAFT) {
      throw new BadRequestException(
        'Only a DRAFT delivery challan can be cancelled (a dispatched DC has already moved stock)',
      );
    }
    await this.prisma.deliveryChallan.update({
      where: { id },
      data: { status: DeliveryChallanStatus.CANCELLED },
    });
    return this.get(id);
  }

  // ── Dispatch: STOCK_OUT + draft invoice (the core action) ────────────
  async dispatch(
    id: string,
    user: AuthenticatedUser,
  ): Promise<DeliveryChallanEntity> {
    await this.access.assertCanDispatch(user);
    const dc = await this.findOrThrow(id);
    if (dc.status !== DeliveryChallanStatus.DRAFT) {
      throw new BadRequestException(
        `Only a DRAFT delivery challan can be dispatched (current: ${dc.status})`,
      );
    }
    if (dc.lines.length === 0) {
      throw new BadRequestException(
        'Cannot dispatch a delivery challan with no lines',
      );
    }

    // QC gate — the order's finished goods must have passed final QC.
    const order = await this.prisma.order.findUniqueOrThrow({
      where: { id: dc.orderId },
    });
    if (order.finalQcStatus !== OrderFinalQcStatus.CLEARED) {
      throw new BadRequestException(
        'Order has not passed final QC — dispatch is blocked until final QC is cleared',
      );
    }

    const stockLines = dc.lines.filter((line) =>
      requiresInternalDispatchStock(line.orderLine),
    );

    // Resolve a store only when at least one line is fulfilled from company
    // inventory. A vendor-only dispatch never touches the internal stock ledger.
    const store =
      stockLines.length > 0
        ? await this.prisma.storeLocation.findFirst({
            where: { code: 'MAIN' },
            select: { id: true },
          })
        : null;
    if (stockLines.length > 0 && !store) {
      throw new BadRequestException(
        'No store location configured to dispatch from',
      );
    }

    // Seed the place-of-supply from the consignee state; GST rates are best-effort
    // (Finance corrects at approval): IGST if consignee state differs from the
    // company's state, else CGST+SGST. Company state comes from finance settings.
    const settings = await this.prisma.financeCompanySettings.findUnique({
      where: { id: 'INDIA' },
    });
    const companyStateCode = settings?.stateCode ?? null;
    const interState =
      !!companyStateCode && companyStateCode !== dc.consigneeStateCode;
    const DEFAULT_GST = 18; // best-effort default rate; Finance overrides.

    await this.prisma.$transaction(async (tx) => {
      // 1) STOCK_OUT only for lines fulfilled from internal inventory.
      for (const line of stockLines) {
        await this.inventory.issueStockOutTx(tx, {
          itemId: line.itemId,
          storeLocationId: store!.id,
          quantity: line.quantity,
          reason: `Dispatch ${dc.dcNumber} (order ${dc.order?.orderNumber ?? dc.orderId})`,
          actorId: user.id,
        });
      }

      // 2) Seed a DRAFT invoice covering ONLY this DC's lines.
      const invoice = await this.ar.createDraftInvoiceFromDispatch(
        {
          customerId: dc.customerId,
          orderId: dc.orderId,
          customerPoReference: dc.customerPoReference ?? undefined,
          placeOfSupplyState: dc.consigneeStateCode,
          placeOfSupplyStateCode: dc.consigneeStateCode,
          createdById: user.id,
          lines: dc.lines.map((l) => ({
            productId: undefined,
            description: l.description,
            hsnSacCode: l.hsnCode ?? 'NA',
            quantity: l.quantity,
            unitOfMeasure: l.unitOfMeasure,
            unitPrice: l.unitRate,
            ...(interState
              ? { igstRate: DEFAULT_GST }
              : { cgstRate: DEFAULT_GST / 2, sgstRate: DEFAULT_GST / 2 }),
          })),
        },
        tx,
      );

      // 3) Flip the DC to DISPATCHED and link the invoice.
      await tx.deliveryChallan.update({
        where: { id },
        data: {
          status: DeliveryChallanStatus.DISPATCHED,
          linkedInvoiceId: invoice.id,
        },
      });

      // 4) Re-derive the order's fulfilment status from cumulative dispatched.
      await this.deriveOrderFulfilment(tx, dc.orderId);
    });

    // Only reachable once the DRAFT → DISPATCHED transition has committed, so a
    // blocked or failed dispatch never notifies anyone that goods have left.
    void this.pushEvents.orderDispatched({ challanId: id, actorId: user.id });
    const entity = await this.get(id);
    entity.overDispatchWarnings = await this.computeOverDispatchWarnings(
      dc.orderId,
    );
    return entity;
  }

  // ── E-way bill (manual entry) ────────────────────────────────────────
  async setEwayBill(
    id: string,
    dto: EwayBillDto,
    user: AuthenticatedUser,
  ): Promise<DeliveryChallanEntity> {
    await this.access.assertCanDispatch(user);
    const dc = await this.prisma.deliveryChallan.findUnique({ where: { id } });
    if (!dc) throw new NotFoundException('Delivery challan not found');
    if (dc.status === DeliveryChallanStatus.DRAFT) {
      throw new BadRequestException(
        'Dispatch the challan before recording e-way bill details',
      );
    }
    await this.prisma.deliveryChallan.update({
      where: { id },
      data: {
        eWayBillNumber: dto.eWayBillNumber,
        eWayBillDate: dto.eWayBillDate ? new Date(dto.eWayBillDate) : null,
        eWayBillValidUntil: dto.eWayBillValidUntil
          ? new Date(dto.eWayBillValidUntil)
          : null,
      },
    });
    return this.get(id);
  }

  // ── Status progression ───────────────────────────────────────────────
  async updateStatus(
    id: string,
    status: 'IN_TRANSIT' | 'DELIVERED',
    user: AuthenticatedUser,
  ): Promise<DeliveryChallanEntity> {
    await this.access.assertCanDispatch(user);
    const dc = await this.prisma.deliveryChallan.findUnique({ where: { id } });
    if (!dc) throw new NotFoundException('Delivery challan not found');
    const allowed: Record<string, DeliveryChallanStatus[]> = {
      [DeliveryChallanStatus.DISPATCHED]: [
        DeliveryChallanStatus.IN_TRANSIT,
        DeliveryChallanStatus.DELIVERED,
      ],
      [DeliveryChallanStatus.IN_TRANSIT]: [DeliveryChallanStatus.DELIVERED],
    };
    if (!allowed[dc.status]?.includes(status as DeliveryChallanStatus)) {
      throw new BadRequestException(
        `Cannot move a delivery challan from ${dc.status} to ${status}`,
      );
    }
    await this.prisma.deliveryChallan.update({
      where: { id },
      data: { status: status as DeliveryChallanStatus },
    });
    return this.get(id);
  }

  // ── Proof of delivery (R2, reusing vault guardrails) ─────────────────
  async createPodUploadUrl(
    id: string,
    fileName: string,
    contentType: string,
    user: AuthenticatedUser,
  ) {
    await this.access.assertCanDispatch(user);
    assertExtensionAllowed(fileName);
    const dc = await this.prisma.deliveryChallan.findUnique({ where: { id } });
    if (!dc) throw new NotFoundException('Delivery challan not found');
    const storageKey = `logistics/pod/${id}/${Date.now()}-${fileName}`;
    const signed = await this.storage.createUploadUrl(storageKey, contentType);
    return {
      storageKey,
      uploadUrl: signed.url,
      expiresInSeconds: signed.expiresInSeconds,
    };
  }

  async confirmPod(
    id: string,
    dto: ConfirmPodDto,
    storageKey: string,
    user: AuthenticatedUser,
  ): Promise<DeliveryChallanEntity> {
    await this.access.assertCanDispatch(user);
    assertExtensionAllowed(dto.fileName);
    assertSizeWithinCap(dto.sizeBytes);
    const dc = await this.prisma.deliveryChallan.findUnique({ where: { id } });
    if (!dc) throw new NotFoundException('Delivery challan not found');
    // Verify the object really landed in R2 before recording it.
    const head = await this.storage.headObject(storageKey);
    if (!head)
      throw new BadRequestException('POD upload was not found in storage');
    await this.prisma.deliveryChallan.update({
      where: { id },
      data: {
        podFileKey: storageKey,
        podReceivedBy: dto.podReceivedBy ?? null,
        podNotes: dto.podNotes ?? null,
        actualDeliveryDate: dto.actualDeliveryDate
          ? new Date(dto.actualDeliveryDate)
          : new Date(),
        status: DeliveryChallanStatus.DELIVERED,
      },
    });
    return this.get(id);
  }

  async podDownloadUrl(id: string, user: AuthenticatedUser) {
    void user; // company-wide read
    const dc = await this.prisma.deliveryChallan.findUnique({ where: { id } });
    if (!dc?.podFileKey)
      throw new NotFoundException('No proof of delivery on file');
    return this.storage.createDownloadUrl(dc.podFileKey);
  }

  // ── Helpers ──────────────────────────────────────────────────────────
  private async findOrThrow(id: string): Promise<DcWithRelations> {
    const row = await this.prisma.deliveryChallan.findUnique({
      where: { id },
      include: DC_INCLUDE,
    });
    if (!row) throw new NotFoundException('Delivery challan not found');
    return row;
  }

  private async loadOrderForDispatch(orderId: string) {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: {
        lineItems: {
          include: {
            product: {
              select: {
                name: true,
                hsnCode: true,
                itemId: true,
                unitOfMeasure: true,
              },
            },
          },
        },
      },
    });
    if (!order) throw new NotFoundException('Order not found');
    if (order.status === 'CANCELLED') {
      throw new BadRequestException(
        'Cannot dispatch against a cancelled order',
      );
    }
    return order;
  }

  private async buildLineData(
    lines: DeliveryChallanLineInputDto[],
    order: Prisma.OrderGetPayload<{
      include: {
        lineItems: {
          include: {
            product: {
              select: {
                name: true;
                hsnCode: true;
                itemId: true;
                unitOfMeasure: true;
              };
            };
          };
        };
      };
    }>,
  ): Promise<Prisma.DeliveryChallanLineCreateWithoutDeliveryChallanInput[]> {
    const orderLineById = new Map(order.lineItems.map((l) => [l.id, l]));
    return lines.map((l, i) => {
      const orderLine = orderLineById.get(l.orderLineId);
      if (!orderLine) {
        throw new BadRequestException(
          `Line references an order line (${l.orderLineId}) not on order ${order.id}`,
        );
      }
      if (!orderLine.product) {
        throw new BadRequestException(
          `Ad-hoc product "${orderLine.adHocProductName ?? 'Unnamed product'}" must be resolved before dispatch`,
        );
      }
      if (!orderLine.product.itemId) {
        throw new BadRequestException(
          `Product "${orderLine.product.name}" has no linked stock Item — cannot dispatch it`,
        );
      }
      const qty = new Prisma.Decimal(l.quantity);
      if (qty.lessThanOrEqualTo(0)) {
        throw new BadRequestException('Dispatch quantity must be positive');
      }
      const rate = orderLine.unitPrice;
      return {
        item: { connect: { id: orderLine.product.itemId } },
        orderLine: { connect: { id: orderLine.id } },
        // Snapshot the customer-facing wording: this description prints on
        // the challan and seeds the dispatch-triggered draft invoice line.
        description:
          l.description ??
          orderLine.customerFacingProductName ??
          orderLine.product.name,
        hsnCode: orderLine.product.hsnCode ?? null,
        quantity: qty,
        unitOfMeasure: orderLine.product.unitOfMeasure,
        unitRate: rate,
        lineValue: qty.times(rate).toDecimalPlaces(2),
        sequence: l.sequence ?? i,
      };
    });
  }

  /** Cumulative dispatched qty per order line across all non-cancelled DCs. */
  private async cumulativeDispatchedByOrderLine(
    tx: Prisma.TransactionClient | PrismaService,
    orderId: string,
  ): Promise<Map<string, Prisma.Decimal>> {
    const rows = await tx.deliveryChallanLine.findMany({
      where: {
        deliveryChallan: { orderId, status: { in: ACTIVE_DC } },
      },
      select: { orderLineId: true, quantity: true },
    });
    const acc = new Map<string, Prisma.Decimal>();
    for (const r of rows) {
      const prev = acc.get(r.orderLineId) ?? new Prisma.Decimal(0);
      acc.set(r.orderLineId, prev.plus(r.quantity));
    }
    return acc;
  }

  private async deriveOrderFulfilment(
    tx: Prisma.TransactionClient,
    orderId: string,
  ): Promise<void> {
    const order = await tx.order.findUnique({
      where: { id: orderId },
      include: { lineItems: { select: { id: true, quantity: true } } },
    });
    if (!order) return;
    const dispatched = await this.cumulativeDispatchedByOrderLine(tx, orderId);
    let anyDispatched = false;
    let allFull = order.lineItems.length > 0;
    for (const line of order.lineItems) {
      const got = dispatched.get(line.id) ?? new Prisma.Decimal(0);
      if (got.greaterThan(0)) anyDispatched = true;
      if (got.lessThan(line.quantity)) allFull = false;
    }
    const derived = allFull
      ? OrderFulfilmentStatus.FULLY_DISPATCHED
      : anyDispatched
        ? OrderFulfilmentStatus.PARTIALLY_DISPATCHED
        : OrderFulfilmentStatus.NOT_DISPATCHED;
    if (derived !== order.fulfilmentStatus) {
      await tx.order.update({
        where: { id: orderId },
        data: { fulfilmentStatus: derived },
      });
    }
  }

  private async computeOverDispatchWarnings(
    orderId: string,
  ): Promise<OverDispatchWarningEntity[]> {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: {
        lineItems: { include: { product: { select: { name: true } } } },
      },
    });
    if (!order) return [];
    const dispatched = await this.cumulativeDispatchedByOrderLine(
      this.prisma,
      orderId,
    );
    const warnings: OverDispatchWarningEntity[] = [];
    for (const line of order.lineItems) {
      const got = dispatched.get(line.id) ?? new Prisma.Decimal(0);
      if (got.greaterThan(line.quantity)) {
        warnings.push(
          new OverDispatchWarningEntity({
            orderLineId: line.id,
            description:
              line.customerFacingProductName ??
              line.product?.name ??
              line.adHocProductName ??
              'Unnamed product',
            orderedQuantity: line.quantity.toString(),
            cumulativeDispatched: got.toString(),
            message: `Over-dispatch: ${got} dispatched against ${line.quantity} ordered for ${line.customerFacingProductName ?? line.product?.name ?? line.adHocProductName ?? 'Unnamed product'}.`,
          }),
        );
      }
    }
    return warnings;
  }

  private async toEntity(dc: DcWithRelations): Promise<DeliveryChallanEntity> {
    // "Previously dispatched" per line = cumulative dispatched from OTHER
    // non-cancelled DCs against the same order line (excludes this DC).
    const orderLineIds = [...new Set(dc.lines.map((l) => l.orderLineId))];
    const priorRows = orderLineIds.length
      ? await this.prisma.deliveryChallanLine.findMany({
          where: {
            orderLineId: { in: orderLineIds },
            deliveryChallanId: { not: dc.id },
            deliveryChallan: { status: { in: ACTIVE_DC } },
          },
          select: { orderLineId: true, quantity: true },
        })
      : [];
    const priorByLine = new Map<string, Prisma.Decimal>();
    for (const r of priorRows) {
      const prev = priorByLine.get(r.orderLineId) ?? new Prisma.Decimal(0);
      priorByLine.set(r.orderLineId, prev.plus(r.quantity));
    }

    return new DeliveryChallanEntity({
      id: dc.id,
      dcNumber: dc.dcNumber,
      status: dc.status,
      orderId: dc.orderId,
      orderNumber: dc.order?.orderNumber ?? null,
      customerId: dc.customerId,
      customerName: dc.customer?.name ?? null,
      customerPoReference: dc.customerPoReference,
      dispatchDate: dc.dispatchDate.toISOString(),
      consigneeName: dc.consigneeName,
      consigneeAddress: dc.consigneeAddress,
      consigneeGstin: dc.consigneeGstin,
      consigneeStateCode: dc.consigneeStateCode,
      transportMode: dc.transportMode,
      transporterName: dc.transporterName,
      vehicleOrAwbNumber: dc.vehicleOrAwbNumber,
      driverName: dc.driverName,
      driverPhone: dc.driverPhone,
      specialDeliveryInstructions: dc.specialDeliveryInstructions,
      documentsIncluded:
        (dc.documentsIncluded as Record<string, boolean> | null) ?? null,
      promisedDeliveryDate: dc.promisedDeliveryDate
        ? dc.promisedDeliveryDate.toISOString()
        : null,
      actualDeliveryDate: dc.actualDeliveryDate
        ? dc.actualDeliveryDate.toISOString()
        : null,
      linkedInvoiceId: dc.linkedInvoiceId,
      linkedInvoiceNumber: dc.linkedInvoice?.invoiceNumber ?? null,
      linkedInvoiceStatus: dc.linkedInvoice?.status ?? null,
      eWayBillNumber: dc.eWayBillNumber,
      eWayBillDate: dc.eWayBillDate ? dc.eWayBillDate.toISOString() : null,
      eWayBillValidUntil: dc.eWayBillValidUntil
        ? dc.eWayBillValidUntil.toISOString()
        : null,
      podFileKey: dc.podFileKey,
      podReceivedBy: dc.podReceivedBy,
      podNotes: dc.podNotes,
      createdById: dc.createdById,
      createdByName: dc.createdBy
        ? `${dc.createdBy.firstName} ${dc.createdBy.lastName}`.trim()
        : null,
      lines: dc.lines.map(
        (l) =>
          new DeliveryChallanLineEntity({
            id: l.id,
            orderLineId: l.orderLineId,
            itemId: l.itemId,
            itemCode: l.item?.itemCode ?? null,
            description: l.description,
            hsnCode: l.hsnCode,
            quantity: l.quantity.toString(),
            unitOfMeasure: l.unitOfMeasure,
            unitRate: l.unitRate.toString(),
            lineValue: l.lineValue.toString(),
            orderedQuantity: l.orderLine?.quantity.toString() ?? '0',
            previouslyDispatched: (
              priorByLine.get(l.orderLineId) ?? new Prisma.Decimal(0)
            ).toString(),
            sequence: l.sequence,
          }),
      ),
      createdAt: dc.createdAt.toISOString(),
      updatedAt: dc.updatedAt.toISOString(),
    });
  }
}
