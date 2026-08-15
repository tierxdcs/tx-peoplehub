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
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../../core/database/prisma.service';
import { AuthenticatedUser } from '../../common/decorators/current-user.decorator';
import { PaginatedResult } from '../../common/dto/pagination.dto';
import { OrderEntity, OrderLineItemEntity } from './entities/order.entity';
import { CreateInternalOrderDto } from './dto/create-internal-order.dto';
import { ListOrdersQueryDto } from './dto/list-orders-query.dto';
import { PromoteInternalOrderDto } from './dto/promote-internal-order.dto';
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
  product: { name: string; sku: string };
  // Present only when the query included plmTracker (findOne). Lets the entity
  // report whether a line carries in-progress PLM/design work.
  plmTracker?: { id: string } | null;
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
            create: bid.lineItems.map((li) => ({
              productId: li.productId!,
              quantity: li.quantity,
              unitPrice: li.unitPrice,
              lineTotal: li.lineTotal,
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

    const productIds = dto.lineItems.map((li) => li.productId);
    if (new Set(productIds).size !== productIds.length) {
      throw new BadRequestException(
        'Each product may appear only once in an order',
      );
    }
    const products = await this.prisma.product.findMany({
      where: { id: { in: productIds } },
      select: { id: true },
    });
    if (products.length !== productIds.length) {
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
              productId: li.productId,
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
        lineItems: { include: { plmTracker: { select: { id: true } } } },
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
      order.lineItems.map((li) => [li.productId, li]),
    );
    const confirmedSet = new Set(confirmedProductIds);
    // Order lines the promoter dropped from the confirmed set are reconciled by
    // whether they carry PLM/design work:
    //   - with a tracker → KEPT untouched (deleting the line would
    //     onDelete: Cascade-destroy the tracker + its events/cards). It stays
    //     at its existing zero pricing — an R&D artifact carried forward. This
    //     is why an internal-only product (never in the bid, so unpriceable)
    //     with design work is still promotable: it is kept, not removed.
    //   - without a tracker → deleted (the customer isn't ordering it and no
    //     design work would be lost).
    const dropped = order.lineItems.filter(
      (li) => !confirmedSet.has(li.productId),
    );
    const toDelete = dropped.filter((li) => li.plmTracker === null);

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
          lineItems: { include: { product: true } },
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

  private async findRawOrThrow(id: string): Promise<OrderWithLines> {
    const order = await this.prisma.order.findUnique({
      where: { id },
      include: {
        lineItems: {
          include: {
            product: true,
            // Drives OrderLineItemEntity.hasPlmTracker — used by the bid
            // promotion reconciliation UI to lock lines with design work.
            plmTracker: { select: { id: true } },
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
            productName: li.product.name,
            productSku: li.product.sku,
            quantity: li.quantity.toString(),
            unitPrice: li.unitPrice.toString(),
            lineTotal: li.lineTotal.toString(),
            deliveryType: li.deliveryType,
            vendorName: li.vendorName,
            vendorContactInfo: li.vendorContactInfo,
            vendorExpectedLeadTime: li.vendorExpectedLeadTime,
            // Only populated when the fetch included plmTracker (findOne);
            // undefined elsewhere so list paths stay cheap.
            hasPlmTracker:
              li.plmTracker === undefined ? undefined : li.plmTracker !== null,
          }),
      ),
      createdAt: order.createdAt,
      updatedAt: order.updatedAt,
    });
  }
}
