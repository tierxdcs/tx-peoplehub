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
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../../core/database/prisma.service';
import { AuthenticatedUser } from '../../common/decorators/current-user.decorator';
import {
  PaginatedResult,
  PaginationQueryDto,
} from '../../common/dto/pagination.dto';
import { OrderEntity, OrderLineItemEntity } from './entities/order.entity';
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
};
type OrderWithLines = Order & { lineItems: OrderLineItemWithProduct[] };

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
      include: { lineItems: { include: { product: true } } },
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
          bidId: bid.id,
          customerId: bid.customerId,
          ownerId: bid.createdById,
          // Snapshot the accepted bid's total as the order's booked value.
          totalAmount: bid.totalAmount,
          lineItems: {
            create: bid.lineItems.map((li) => ({
              productId: li.productId,
              quantity: li.quantity,
              unitPrice: li.unitPrice,
              lineTotal: li.lineTotal,
            })),
          },
        },
        include: { lineItems: { include: { product: true } } },
      });
    });
    return this.toEntity(created);
  }

  async findAll(
    query: PaginationQueryDto,
    user: AuthenticatedUser,
  ): Promise<PaginatedResult<OrderEntity>> {
    await this.access.assertSalesAccess(user);
    // Vertical-wide read: any Sales-vertical staff may view all Orders.
    const where: Prisma.OrderWhereInput = {};

    const [items, total] = await this.prisma.$transaction([
      this.prisma.order.findMany({
        where,
        include: { lineItems: { include: { product: true } } },
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
    await this.access.assertSalesAccess(user);
    // Vertical-wide read — any Sales-vertical staff may view any Order.
    const order = await this.findRawOrThrow(id);
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
      include: { lineItems: { include: { product: true } } },
    });
    return this.toEntity(updated);
  }

  private async findRawOrThrow(id: string): Promise<OrderWithLines> {
    const order = await this.prisma.order.findUnique({
      where: { id },
      include: { lineItems: { include: { product: true } } },
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
      bidId: order.bidId,
      customerId: order.customerId,
      status: order.status,
      totalAmount: order.totalAmount.toString(),
      productionRunId: order.productionRunId,
      shipmentId: order.shipmentId,
      ownerId: order.ownerId,
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
          }),
      ),
      createdAt: order.createdAt,
      updatedAt: order.updatedAt,
    });
  }
}
