import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  BidStatus,
  Order,
  OrderLineItem,
  OrderStatus,
  OrderType,
  PlmStage,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../../core/database/prisma.service';
import { AuthenticatedUser } from '../../common/decorators/current-user.decorator';
import { PaginatedResult } from '../../common/dto/pagination.dto';
import { OrderEntity, OrderLineItemEntity } from './entities/order.entity';
import { CreateInternalOrderDto } from './dto/create-internal-order.dto';
import { ListOrdersQueryDto } from './dto/list-orders-query.dto';
import { PromoteInternalOrderDto } from './dto/promote-internal-order.dto';
import { ResolveBidLineItemDto } from './dto/resolve-bid-line-item.dto';
import { UpdateOrderLineItemDto } from './dto/update-order-line-item.dto';
import {
  ConvertBidToOrderDto,
  UpdateLineCustomerFacingDto,
} from './dto/customer-facing-line.dto';
import { SalesAccessService } from './common/sales-access.service';
import { SalesNumberingService } from './common/sales-numbering.service';
import { ConfirmationSheetsService } from './confirmation-sheets.service';

/**
 * Legal forward status transitions. CANCELLED is reachable from any
 * non-terminal state. DELIVERED and CANCELLED are terminal.
 */
const ORDER_TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  [OrderStatus.CONFIRMED]: [OrderStatus.IN_PRODUCTION, OrderStatus.CANCELLED],
  [OrderStatus.IN_PRODUCTION]: [
    OrderStatus.READY_TO_SHIP,
    OrderStatus.CANCELLED,
  ],
  [OrderStatus.READY_TO_SHIP]: [OrderStatus.SHIPPED, OrderStatus.CANCELLED],
  [OrderStatus.SHIPPED]: [OrderStatus.DELIVERED, OrderStatus.CANCELLED],
  [OrderStatus.DELIVERED]: [],
  [OrderStatus.CANCELLED]: [],
};

type OrderLineItemWithProduct = OrderLineItem & {
  product: { name: string; sku: string } | null;
  // Present only when the query included plmTrackers (findOne). A line now has
  // one tracker per delivery split, so this is an array; the entity reports
  // whether ANY split carries in-progress PLM/design work.
  plmTrackers?: { id: string; currentStage?: PlmStage }[];
};
type OrderWithLines = Order & {
  lineItems: OrderLineItemWithProduct[];
  customer?: { name: string } | null;
  enquiryCreator?: { firstName: string; lastName: string } | null;
  owner: { firstName: string; lastName: string };
  businessUnit?: { name: string; colorHex: string } | null;
};

@Injectable()
export class OrdersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: SalesAccessService,
    private readonly numbering: SalesNumberingService,
    private readonly confirmationSheets: ConfirmationSheetsService,
  ) {}

  /**
   * Convert an ACCEPTED bid into a CONFIRMED order, copying the bid's line
   * items (product/quantity/unitPrice snapshot/lineTotal). The order is
   * owned by the bid's creator. One transaction so a partial copy can't
   * leave an order with no lines or a burned order number.
   */
  async convertFromBid(
    bidId: string,
    user: AuthenticatedUser,
    dto?: ConvertBidToOrderDto,
  ): Promise<OrderEntity> {
    await this.access.assertSalesAccess(user);
    const bid = await this.prisma.bid.findUnique({
      where: { id: bidId },
      include: {
        lineItems: {
          include: {
            product: {
              include: {
                customerBomIntake: {
                  select: {
                    id: true,
                    bom: { select: { status: true } },
                  },
                },
              },
            },
          },
        },
        amcCharges: true,
      },
    });
    if (!bid) {
      throw new NotFoundException('Bid not found');
    }
    await this.access.assertCanAccessOwned(user, bid.createdById);

    if (bid.status !== BidStatus.ACCEPTED) {
      throw new BadRequestException(
        `Only an ACCEPTED bid can be converted to an order (current status: ${bid.status})`,
      );
    }
    const existing = await this.prisma.order.findFirst({ where: { bidId } });
    if (existing) {
      throw new BadRequestException(
        'This bid has already been converted to an order',
      );
    }

    // Formalization gate: no order may reference an ad-hoc placeholder. Every
    // line must have been resolved to a real Product first.
    const unresolved = bid.lineItems.filter((li) => li.productId === null);
    if (unresolved.length > 0) {
      throw new BadRequestException(
        `This bid has ${unresolved.length} line item(s) awaiting product setup — resolve them before converting to an order`,
      );
    }

    const unreleasedCustomerBoms = bid.lineItems.filter((line) => {
      const intake = line.product?.customerBomIntake;
      return intake && intake.bom?.status !== 'RELEASED';
    });
    if (unreleasedCustomerBoms.length > 0) {
      throw new BadRequestException(
        `This bid has ${unreleasedCustomerBoms.length} customer-BOM product(s) still awaiting R&D release — release every linked BOM before converting to an order`,
      );
    }

    const created = await this.prisma.$transaction(async (tx) => {
      const amcTotal = (bid.amcCharges ?? []).reduce(
        (sum, charge) => sum.plus(charge.amount),
        new Prisma.Decimal(0),
      );
      const orderNumber = await this.numbering.nextNumber(
        'ORD',
        'order',
        new Date().getUTCFullYear(),
        tx,
      );
      return tx.order.create({
        data: {
          orderNumber,
          orderType: OrderType.CUSTOMER,
          bidId: bid.id,
          customerId: bid.customerId,
          ownerId: bid.createdById,
          enquiryCreatorId: bid.enquiryCreatorId,
          businessUnitId: bid.businessUnitId,
          // Snapshot the full accepted quotation value, including flat AMC.
          totalAmount: bid.totalAmount.plus(amcTotal),
          lineItems: {
            // productId is guaranteed non-null by the formalization gate above.
            // Customer-facing overrides (the customer PO's own wording) are
            // captured per BID line at conversion time — display-only.
            create: bid.lineItems.map((li) => {
              const override = dto?.lineOverrides?.find(
                (o) => o.bidLineItemId === li.id,
              );
              return {
                productId: li.productId!,
                quantity: li.quantity,
                unitPrice: li.unitPrice,
                lineTotal: li.lineTotal,
                customerFacingProductName:
                  override?.customerFacingProductName?.trim() || null,
                customerFacingDescription:
                  override?.customerFacingDescription?.trim() || null,
              };
            }),
          },
        },
        include: {
          lineItems: { include: { product: true } },
          customer: { select: { name: true } },
          enquiryCreator: { select: { firstName: true, lastName: true } },
          owner: { select: { firstName: true, lastName: true } },
          businessUnit: { select: { name: true, colorHex: true } },
        },
      });
    });
    return this.toEntity(created);
  }

  /**
   * Create an INTERNAL order directly — no Bid, OCS, or committed customer.
   * For samples / speculative Design-to-Dispatch builds. Line items describe
   * what's being built (real Product + quantity) with NO pricing: unit price,
   * line total and the order total are all zero. Creatable by Sales, R&D, or
   * a Project Manager (see assertCanCreateInternalOrder). The order is excluded
   * from revenue/booked aggregation until it is promoted (see
   * {@link promoteInternalOrder}).
   */
  async createInternal(
    dto: CreateInternalOrderDto,
    user: AuthenticatedUser,
  ): Promise<OrderEntity> {
    await this.access.assertCanCreateInternalOrder(user);

    for (const li of dto.lineItems) {
      const hasProduct = !!li.productId;
      const hasAdHoc = !!li.adHocProductName?.trim();
      if (hasProduct === hasAdHoc) {
        throw new BadRequestException(
          'Each line item must set exactly one of productId or adHocProductName',
        );
      }
    }

    const productIds = dto.lineItems
      .map((li) => li.productId)
      .filter((id): id is string => !!id);
    if (new Set(productIds).size !== productIds.length) {
      throw new BadRequestException(
        'Each product may appear only once in an order',
      );
    }
    const products = await this.prisma.product.findMany({
      where: { id: { in: productIds } },
      select: { id: true },
    });
    if (products.length !== new Set(productIds).size) {
      throw new BadRequestException('One or more products do not exist');
    }
    if (dto.customerId) {
      const customer = await this.prisma.customer.findUnique({
        where: { id: dto.customerId },
        select: { id: true },
      });
      if (!customer) {
        throw new BadRequestException('Prospective customer not found');
      }
    }
    if (dto.businessUnitId) {
      const bu = await this.prisma.businessUnit.findUnique({
        where: { id: dto.businessUnitId },
        select: { id: true },
      });
      if (!bu) {
        throw new BadRequestException('Business unit not found');
      }
    }

    const created = await this.prisma.$transaction(async (tx) => {
      const orderNumber = await this.numbering.nextNumber(
        'ORD',
        'order',
        new Date().getUTCFullYear(),
        tx,
      );
      return tx.order.create({
        data: {
          orderNumber,
          orderType: OrderType.INTERNAL,
          bidId: null,
          // Prospective customer is a non-committal tag (optional).
          customerId: dto.customerId ?? null,
          ownerId: user.id,
          businessUnitId: dto.businessUnitId ?? null,
          // No pricing behind an internal order.
          totalAmount: new Prisma.Decimal(0),
          lineItems: {
            create: dto.lineItems.map((li) => ({
              productId: li.productId ?? null,
              adHocProductName: li.productId
                ? null
                : li.adHocProductName!.trim(),
              adHocDescription: li.productId
                ? null
                : li.adHocDescription?.trim() || null,
              quantity: new Prisma.Decimal(li.quantity),
              unitPrice: new Prisma.Decimal(0),
              lineTotal: new Prisma.Decimal(0),
            })),
          },
        },
        include: {
          lineItems: { include: { product: true } },
          customer: { select: { name: true } },
          enquiryCreator: { select: { firstName: true, lastName: true } },
          owner: { select: { firstName: true, lastName: true } },
          businessUnit: { select: { name: true, colorHex: true } },
        },
      });
    });
    return this.toEntity(created);
  }

  /**
   * Promote an existing INTERNAL order to a real CUSTOMER order when a Bid is
   * won — instead of creating a brand-new order — so the internal order's
   * Kickoff/PLM/Kanban history carries forward untouched. Applies the same
   * ACCEPTED/ad-hoc/BOM/one-order-per-bid gates as {@link convertFromBid}, then
   * reconciles line items against `dto.lineItems` (the promoter's confirmed,
   * bid-priced final set) by matching on productId:
   *   - matched (on the order + confirmed) → updated in place (quantity +
   *     pricing from the won bid), so the line's id — and its PLM tracker —
   *     survive;
   *   - new (confirmed, not yet on the order) → created (pricing from the bid);
   *   - dropped (on the order, not confirmed) → deleted only if it has NO PLM
   *     tracker; a line WITH a tracker is KEPT untouched (at its existing zero
   *     pricing) so in-progress design work is never cascade-destroyed.
   * Booked value (`totalAmount`) is the accepted bid's snapshot, exactly as a
   * fresh conversion.
   */
  async promoteInternalOrder(
    bidId: string,
    dto: PromoteInternalOrderDto,
    user: AuthenticatedUser,
  ): Promise<OrderEntity> {
    await this.access.assertSalesAccess(user);

    const bid = await this.prisma.bid.findUnique({
      where: { id: bidId },
      include: {
        lineItems: {
          include: {
            product: {
              include: {
                customerBomIntake: {
                  select: { id: true, bom: { select: { status: true } } },
                },
              },
            },
          },
        },
        amcCharges: true,
      },
    });
    if (!bid) {
      throw new NotFoundException('Bid not found');
    }
    await this.access.assertCanAccessOwned(user, bid.createdById);

    if (bid.status !== BidStatus.ACCEPTED) {
      throw new BadRequestException(
        `Only an ACCEPTED bid can be converted to an order (current status: ${bid.status})`,
      );
    }
    const existingForBid = await this.prisma.order.findFirst({
      where: { bidId },
    });
    if (existingForBid) {
      throw new BadRequestException(
        'This bid has already been converted to an order',
      );
    }
    const unresolved = bid.lineItems.filter((li) => li.productId === null);
    if (unresolved.length > 0) {
      throw new BadRequestException(
        `This bid has ${unresolved.length} line item(s) awaiting product setup — resolve them before converting to an order`,
      );
    }
    const unreleasedCustomerBoms = bid.lineItems.filter((line) => {
      const intake = line.product?.customerBomIntake;
      return intake && intake.bom?.status !== 'RELEASED';
    });
    if (unreleasedCustomerBoms.length > 0) {
      throw new BadRequestException(
        `This bid has ${unreleasedCustomerBoms.length} customer-BOM product(s) still awaiting R&D release — release every linked BOM before converting to an order`,
      );
    }

    const confirmedProductIds = dto.lineItems.map((li) => li.productId);
    if (new Set(confirmedProductIds).size !== confirmedProductIds.length) {
      throw new BadRequestException(
        'Each product may appear only once in the reconciled line items',
      );
    }

    const order = await this.prisma.order.findUnique({
      where: { id: dto.orderId },
      include: {
        lineItems: { include: { plmTrackers: { select: { id: true } } } },
      },
    });
    if (!order) {
      throw new NotFoundException('Internal order not found');
    }
    if (order.orderType !== OrderType.INTERNAL) {
      throw new BadRequestException('Only an internal order can be promoted');
    }
    if (order.bidId) {
      throw new BadRequestException('This order has already been promoted');
    }
    const unresolvedOrderLines = order.lineItems.filter(
      (li) => li.productId === null,
    );
    if (unresolvedOrderLines.length > 0) {
      throw new BadRequestException(
        `This internal order has ${unresolvedOrderLines.length} line item(s) awaiting product setup — resolve them before promotion`,
      );
    }

    // Pricing source = the won bid's per-product line (guaranteed non-null id).
    const bidLineByProduct = new Map(
      bid.lineItems.map((li) => [li.productId as string, li]),
    );
    // Every confirmed product must be part of the won bid — otherwise there is
    // no agreed price for it.
    const unpriced = dto.lineItems.filter(
      (li) => !bidLineByProduct.has(li.productId),
    );
    if (unpriced.length > 0) {
      throw new BadRequestException(
        `${unpriced.length} line item(s) are not part of the won bid, so they have no agreed price — remove them from the promotion or add them to the bid first`,
      );
    }

    const orderLineByProduct = new Map(
      order.lineItems.map((li) => [li.productId!, li]),
    );
    const confirmedSet = new Set(confirmedProductIds);
    // Order lines the promoter dropped from the confirmed set are reconciled by
    // whether any of their delivery splits carry PLM/design work:
    //   - any split with a tracker → line KEPT untouched (deleting it would
    //     onDelete: Cascade-destroy the split's tracker + its events/cards). It
    //     stays at its existing zero pricing — an R&D artifact carried forward.
    //     This is why an internal-only product (never in the bid, so
    //     unpriceable) with design work is still promotable: it is kept.
    //   - no split with a tracker → deleted (the customer isn't ordering it and
    //     no design work would be lost).
    const dropped = order.lineItems.filter(
      (li) => !li.productId || !confirmedSet.has(li.productId),
    );
    const toDelete = dropped.filter(
      (li) => (li.plmTrackers?.length ?? 0) === 0,
    );

    const amcTotal = (bid.amcCharges ?? []).reduce(
      (sum, charge) => sum.plus(charge.amount),
      new Prisma.Decimal(0),
    );

    const promoted = await this.prisma.$transaction(async (tx) => {
      if (toDelete.length > 0) {
        await tx.orderLineItem.deleteMany({
          where: { id: { in: toDelete.map((li) => li.id) } },
        });
      }
      for (const li of dto.lineItems) {
        const bidLine = bidLineByProduct.get(li.productId)!;
        const qty = new Prisma.Decimal(li.quantity);
        const lineTotal = bidLine.unitPrice.mul(qty);
        const existing = orderLineByProduct.get(li.productId);
        if (existing) {
          // Update in place — keeps the row id, so its PLM tracker survives.
          await tx.orderLineItem.update({
            where: { id: existing.id },
            data: { quantity: qty, unitPrice: bidLine.unitPrice, lineTotal },
          });
        } else {
          await tx.orderLineItem.create({
            data: {
              orderId: order.id,
              productId: li.productId,
              quantity: qty,
              unitPrice: bidLine.unitPrice,
              lineTotal,
            },
          });
        }
      }
      return tx.order.update({
        where: { id: order.id },
        data: {
          orderType: OrderType.CUSTOMER,
          bidId: bid.id,
          customerId: bid.customerId,
          enquiryCreatorId: bid.enquiryCreatorId,
          businessUnitId: bid.businessUnitId,
          // Booked value = accepted quotation total incl. flat AMC (same rule
          // as convertFromBid); the line items capture the reconciled scope.
          totalAmount: bid.totalAmount.plus(amcTotal),
        },
        include: {
          lineItems: { include: { product: true } },
          customer: { select: { name: true } },
          enquiryCreator: { select: { firstName: true, lastName: true } },
          owner: { select: { firstName: true, lastName: true } },
          businessUnit: { select: { name: true, colorHex: true } },
        },
      });
    });
    return this.toEntity(promoted);
  }

  async findAll(
    query: ListOrdersQueryDto,
    user: AuthenticatedUser,
  ): Promise<PaginatedResult<OrderEntity>> {
    // Sales-vertical staff + SUPER_ADMIN read every order (vertical-wide, as
    // before). R&D / PM (internal-order managers) who are not in Sales may list
    // too, but are hard-scoped to INTERNAL orders regardless of the query.
    const fullAccess = await this.access.hasSalesAccess(user);
    if (!fullAccess) {
      await this.access.assertCanCreateInternalOrder(user);
    }
    const where: Prisma.OrderWhereInput = {};
    if (query.orderType) {
      where.orderType = query.orderType;
    }
    if (!fullAccess) {
      where.orderType = OrderType.INTERNAL;
    }

    const [items, total] = await this.prisma.$transaction([
      this.prisma.order.findMany({
        where,
        include: {
          lineItems: {
            include: {
              product: true,
              // The Sales order status is a separate/manual workflow. Dispatch
              // readiness is driven by PLM, so expose the tracker stage to the
              // order picker instead of requiring somebody to update both.
              plmTrackers: { select: { id: true, currentStage: true } },
            },
          },
          customer: { select: { name: true } },
          enquiryCreator: { select: { firstName: true, lastName: true } },
          owner: { select: { firstName: true, lastName: true } },
          businessUnit: { select: { name: true, colorHex: true } },
        },
        skip: query.skip,
        take: query.limit,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.order.count({ where }),
    ]);
    return {
      items: items.map((o) => this.toEntity(o)),
      total,
      page: query.page,
      limit: query.limit,
    };
  }

  async findOne(id: string, user: AuthenticatedUser): Promise<OrderEntity> {
    const order = await this.findRawOrThrow(id);
    // Sales staff see any order; a non-Sales internal-order manager (R&D/PM)
    // may only see INTERNAL orders — a CUSTOMER order reads as not found so we
    // don't leak its existence.
    if (!(await this.access.hasSalesAccess(user))) {
      await this.access.assertCanCreateInternalOrder(user);
      if (order.orderType !== OrderType.INTERNAL) {
        throw new NotFoundException('Order not found');
      }
    }
    return this.toEntity(order);
  }

  /**
   * Customer-facing display override on one order line — the customer's own
   * PO wording. Display-only by design: never mutates the shared Product,
   * and never affects BOM / cost roll-up / PLM which key on productId.
   * Editable any time (a customer PO often arrives after the order exists).
   * Empty/whitespace values clear the override back to the real name.
   */
  async updateLineCustomerFacing(
    orderId: string,
    lineItemId: string,
    dto: UpdateLineCustomerFacingDto,
    user: AuthenticatedUser,
  ): Promise<OrderEntity> {
    await this.access.assertSalesAccess(user);
    const order = await this.findRawOrThrow(orderId);
    await this.access.assertCanAccessOwned(user, order.ownerId);
    const line = await this.prisma.orderLineItem.findUnique({
      where: { id: lineItemId },
      select: { orderId: true },
    });
    if (!line || line.orderId !== orderId) {
      throw new NotFoundException('Order line item not found on this order');
    }
    await this.prisma.orderLineItem.update({
      where: { id: lineItemId },
      data: {
        ...(dto.customerFacingProductName !== undefined
          ? {
              customerFacingProductName:
                dto.customerFacingProductName?.trim() || null,
            }
          : {}),
        ...(dto.customerFacingDescription !== undefined
          ? {
              customerFacingDescription:
                dto.customerFacingDescription?.trim() || null,
            }
          : {}),
      },
    });
    return this.findOne(orderId, user);
  }

  /**
   * Commercial correction to one order line — the customer PO that follows a
   * quotation rarely covers every quoted item at the quoted rate. Rewrites
   * quantity and/or unit price, re-derives `lineTotal`, and re-derives the
   * order's booked value from the new line set (see
   * {@link recomputeTotalAmount}). The line keeps its id, so its delivery
   * classification and any PLM tracking survive untouched.
   */
  async updateLineItem(
    orderId: string,
    lineItemId: string,
    dto: UpdateOrderLineItemDto,
    user: AuthenticatedUser,
  ): Promise<OrderEntity> {
    if (dto.quantity === undefined && dto.unitPrice === undefined) {
      throw new BadRequestException(
        'Provide a quantity, a unit price, or both',
      );
    }
    const order = await this.findRawOrThrow(orderId);
    await this.assertCanEditLines(order, user);
    const line = order.lineItems.find((li) => li.id === lineItemId);
    if (!line) {
      throw new NotFoundException('Order line item not found on this order');
    }

    const quantity =
      dto.quantity !== undefined
        ? this.money(new Prisma.Decimal(dto.quantity))
        : line.quantity;
    const unitPrice =
      dto.unitPrice !== undefined
        ? this.money(new Prisma.Decimal(dto.unitPrice))
        : line.unitPrice;

    // Never let the ordered quantity fall below what has already left the
    // building — the derived fulfilment status (and the challans themselves)
    // would then describe an over-dispatch that never happened.
    if (dto.quantity !== undefined) {
      const dispatched = await this.prisma.deliveryChallanLine.aggregate({
        where: { orderLineId: lineItemId },
        _sum: { quantity: true },
      });
      const alreadyDispatched =
        dispatched._sum.quantity ?? new Prisma.Decimal(0);
      if (quantity.lessThan(alreadyDispatched)) {
        throw new BadRequestException(
          `${alreadyDispatched.toString()} of this line has already been dispatched — the quantity cannot go below that`,
        );
      }
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.orderLineItem.update({
        where: { id: lineItemId },
        data: {
          quantity,
          unitPrice,
          lineTotal: this.money(unitPrice.times(quantity)),
        },
      });
      await this.recomputeTotalAmount(tx, order);
    });
    return this.findOne(orderId, user);
  }

  /**
   * Drop one line from an order — the customer PO didn't cover it at all.
   * Refused while the line carries downstream work that a delete would
   * cascade-destroy or orphan (a PLM tracker on any delivery split, a QC
   * inspection, a dispatched challan line), and refused for the last remaining
   * line: an order with no scope should be CANCELLED, not emptied.
   */
  async deleteLineItem(
    orderId: string,
    lineItemId: string,
    user: AuthenticatedUser,
  ): Promise<OrderEntity> {
    const order = await this.findRawOrThrow(orderId);
    await this.assertCanEditLines(order, user);
    const line = order.lineItems.find((li) => li.id === lineItemId);
    if (!line) {
      throw new NotFoundException('Order line item not found on this order');
    }
    if (order.lineItems.length === 1) {
      throw new BadRequestException(
        'An order must keep at least one line item — cancel the order instead of removing its last line',
      );
    }
    if ((line.plmTrackers?.length ?? 0) > 0) {
      throw new BadRequestException(
        'Design/vendor (PLM) work has already started on this line — it cannot be removed. Cancel the tracked work first.',
      );
    }
    const [inspections, dispatched] = await Promise.all([
      this.prisma.qmsInspection.count({ where: { orderLineId: lineItemId } }),
      this.prisma.deliveryChallanLine.count({
        where: { orderLineId: lineItemId },
      }),
    ]);
    if (inspections > 0) {
      throw new BadRequestException(
        'This line has QC inspection history and cannot be removed',
      );
    }
    if (dispatched > 0) {
      throw new BadRequestException(
        'This line has already been dispatched on a delivery challan and cannot be removed',
      );
    }

    await this.prisma.$transaction(async (tx) => {
      // Delivery splits hang off the line with onDelete: Cascade; the guards
      // above ensure none of them carries a tracker.
      await tx.orderLineItem.delete({ where: { id: lineItemId } });
      await this.recomputeTotalAmount(tx, order);
    });
    return this.findOne(orderId, user);
  }

  /**
   * WRITE guard shared by the line-item quantity/price/delete paths. Sales owns
   * a customer order's commercials; an INTERNAL order is editable by whoever
   * may create one (Sales, R&D, or a Project Manager — same audience as
   * {@link createInternal}). Editing stops at CONFIRMED: from IN_PRODUCTION
   * onwards, material planning, PLM and dispatch have committed to these
   * quantities, so a change belongs in a revision, not an in-place edit.
   */
  private async assertCanEditLines(
    order: OrderWithLines,
    user: AuthenticatedUser,
  ): Promise<void> {
    if (order.orderType === OrderType.INTERNAL) {
      await this.access.assertCanCreateInternalOrder(user);
    } else {
      await this.access.assertSalesAccess(user);
    }
    await this.access.assertCanAccessOwned(user, order.ownerId);
    if (order.status !== OrderStatus.CONFIRMED) {
      throw new BadRequestException(
        `Line items can only be changed while an order is CONFIRMED — this order is ${order.status}`,
      );
    }
  }

  /**
   * Re-derive the order's booked value after its line set changed. A
   * bid-converted order's total is the accepted quotation's grand total, so the
   * bid's discount percentage, tax rate and flat AMC charges are re-applied
   * over the new line subtotal — the same arithmetic {@link convertFromBid}
   * snapshotted, just over the scope the customer actually ordered. An order
   * with no bid behind it (INTERNAL) totals its lines directly.
   */
  private async recomputeTotalAmount(
    tx: Prisma.TransactionClient,
    order: { id: string; bidId: string | null },
  ): Promise<void> {
    const lines = await tx.orderLineItem.findMany({
      where: { orderId: order.id },
      select: { lineTotal: true },
    });
    const subtotal = lines.reduce(
      (sum, l) => sum.plus(l.lineTotal),
      new Prisma.Decimal(0),
    );
    let totalAmount = this.money(subtotal);

    if (order.bidId) {
      const bid = await tx.bid.findUnique({
        where: { id: order.bidId },
        select: {
          discountPercent: true,
          taxRate: true,
          amcCharges: { select: { amount: true } },
        },
      });
      if (bid) {
        const discountAmount = this.money(
          subtotal.times(bid.discountPercent).dividedBy(100),
        );
        const taxable = subtotal.minus(discountAmount);
        const taxAmount = bid.taxRate
          ? this.money(taxable.times(bid.taxRate).dividedBy(100))
          : new Prisma.Decimal(0);
        const amcTotal = (bid.amcCharges ?? []).reduce(
          (sum, charge) => sum.plus(charge.amount),
          new Prisma.Decimal(0),
        );
        totalAmount = this.money(taxable.plus(taxAmount).plus(amcTotal));
      }
    }

    await tx.order.update({
      where: { id: order.id },
      data: { totalAmount },
    });
  }

  /** Round to 2 places (money precision), matching @db.Decimal(14, 2). */
  private money(value: Prisma.Decimal): Prisma.Decimal {
    return value.toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
  }

  async updateStatus(
    id: string,
    target: OrderStatus,
    user: AuthenticatedUser,
  ): Promise<OrderEntity> {
    await this.access.assertSalesAccess(user);
    const order = await this.findRawOrThrow(id);
    await this.access.assertCanAccessOwned(user, order.ownerId);

    if (!ORDER_TRANSITIONS[order.status].includes(target)) {
      throw new BadRequestException(
        `Cannot move an order from ${order.status} to ${target}`,
      );
    }
    // Hard gate (same enforcement style as the Bid/No-Bid gate on POST /bids):
    // an order cannot enter production until its most-recent Order Confirmation
    // Sheet is EXECUTED (customer-signed + Sales Head countersigned).
    if (target === OrderStatus.IN_PRODUCTION) {
      const executed = await this.confirmationSheets.latestIsExecutedFor(id);
      if (!executed) {
        throw new BadRequestException(
          'This order cannot enter production until its Order Confirmation Sheet is executed (customer-signed and countersigned by the Sales Head)',
        );
      }
    }
    const updated = await this.prisma.order.update({
      where: { id },
      data: { status: target },
      include: {
        lineItems: { include: { product: true } },
        customer: { select: { name: true } },
        owner: { select: { firstName: true, lastName: true } },
      },
    });
    return this.toEntity(updated);
  }

  /** Resolve an INTERNAL order's ad-hoc line in place, preserving its id and
   * therefore any Kickoff/PLM history already attached to that line. */
  async resolveLineItem(
    orderId: string,
    lineItemId: string,
    dto: ResolveBidLineItemDto,
    user: AuthenticatedUser,
  ): Promise<OrderEntity> {
    await this.access.assertSalesAccess(user);
    const order = await this.findRawOrThrow(orderId);
    if (order.orderType !== OrderType.INTERNAL || order.bidId) {
      throw new BadRequestException(
        'Only an unpromoted internal order can resolve ad-hoc products',
      );
    }
    const line = order.lineItems.find((item) => item.id === lineItemId);
    if (!line) throw new NotFoundException('Line item not found on this order');
    if (line.productId !== null) {
      throw new BadRequestException(
        'This line item is already linked to a product',
      );
    }
    const product = await this.prisma.product.findUnique({
      where: { id: dto.productId },
      select: { id: true, isActive: true },
    });
    if (!product)
      throw new NotFoundException('productId does not reference a product');
    if (!product.isActive) {
      throw new BadRequestException(
        'That product is inactive and cannot be used',
      );
    }
    const duplicate = order.lineItems.some(
      (item) => item.id !== lineItemId && item.productId === product.id,
    );
    if (duplicate) {
      throw new BadRequestException(
        'That product already exists on this order',
      );
    }
    await this.prisma.orderLineItem.update({
      where: { id: lineItemId },
      data: {
        productId: product.id,
        adHocProductName: null,
        adHocDescription: null,
      },
    });
    return this.toEntity(await this.findRawOrThrow(orderId));
  }

  private async findRawOrThrow(id: string): Promise<OrderWithLines> {
    const order = await this.prisma.order.findUnique({
      where: { id },
      include: {
        lineItems: {
          include: {
            product: true,
            // Drives OrderLineItemEntity.hasPlmTracker — used by the bid
            // promotion reconciliation UI to lock lines with design work. A line
            // has one tracker per delivery split, so this is an array.
            plmTrackers: { select: { id: true } },
          },
        },
        customer: { select: { name: true } },
        enquiryCreator: { select: { firstName: true, lastName: true } },
        owner: { select: { firstName: true, lastName: true } },
        businessUnit: { select: { name: true, colorHex: true } },
      },
    });
    if (!order) {
      throw new NotFoundException('Order not found');
    }
    return order;
  }

  private toEntity(order: OrderWithLines): OrderEntity {
    return new OrderEntity({
      id: order.id,
      orderNumber: order.orderNumber,
      orderType: order.orderType,
      bidId: order.bidId,
      customerId: order.customerId,
      customerName: order.customer?.name ?? null,
      status: order.status,
      dispatchReady:
        new Set<OrderStatus>([
          OrderStatus.READY_TO_SHIP,
          OrderStatus.SHIPPED,
          OrderStatus.DELIVERED,
        ]).has(order.status) ||
        order.lineItems.some((line) =>
          line.plmTrackers?.some((tracker) =>
            new Set<PlmStage>([PlmStage.DISPATCH, PlmStage.COMPLETED]).has(
              tracker.currentStage as PlmStage,
            ),
          ),
        ),
      finalQcStatus: order.finalQcStatus,
      fulfilmentStatus: order.fulfilmentStatus,
      totalAmount: order.totalAmount.toString(),
      productionRunId: order.productionRunId,
      shipmentId: order.shipmentId,
      ownerId: order.ownerId,
      enquiryCreatorId: order.enquiryCreatorId,
      enquiryCreatorName: order.enquiryCreator
        ? `${order.enquiryCreator.firstName} ${order.enquiryCreator.lastName}`.trim()
        : null,
      ownerName: `${order.owner.firstName} ${order.owner.lastName}`.trim(),
      businessUnitId: order.businessUnitId,
      businessUnitName: order.businessUnit?.name ?? null,
      businessUnitColorHex: order.businessUnit?.colorHex ?? null,
      lineItems: order.lineItems.map(
        (li) =>
          new OrderLineItemEntity({
            id: li.id,
            orderId: li.orderId,
            productId: li.productId,
            adHocProductName: li.adHocProductName,
            adHocDescription: li.adHocDescription,
            isAdHoc: li.productId === null,
            // Order-context surfaces show the customer's own wording when an
            // override exists; internal name stays available alongside.
            productName:
              li.customerFacingProductName ??
              li.product?.name ??
              li.adHocProductName ??
              'Unnamed product',
            internalProductName:
              li.product?.name ?? li.adHocProductName ?? 'Unnamed product',
            customerFacingProductName: li.customerFacingProductName,
            customerFacingDescription: li.customerFacingDescription,
            productSku: li.product?.sku ?? 'Ad-hoc',
            quantity: li.quantity.toString(),
            unitPrice: li.unitPrice.toString(),
            lineTotal: li.lineTotal.toString(),
            deliveryType: li.deliveryType,
            vendorName: li.vendorName,
            vendorContactInfo: li.vendorContactInfo,
            vendorExpectedLeadTime: li.vendorExpectedLeadTime,
            // Only populated when the fetch included plmTrackers (findOne);
            // undefined elsewhere so list paths stay cheap. True when any of the
            // line's delivery splits has a tracker.
            hasPlmTracker:
              li.plmTrackers === undefined
                ? undefined
                : li.plmTrackers.length > 0,
          }),
      ),
      createdAt: order.createdAt,
      updatedAt: order.updatedAt,
    });
  }
}
