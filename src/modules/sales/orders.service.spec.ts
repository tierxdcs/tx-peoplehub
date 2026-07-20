import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { BidStatus, OrderStatus, Prisma, Role } from '@prisma/client';
import { PrismaService } from '../../core/database/prisma.service';
import { AuthenticatedUser } from '../../common/decorators/current-user.decorator';
import { OrdersService } from './orders.service';
import { SalesAccessService } from './common/sales-access.service';
import { SalesNumberingService } from './common/sales-numbering.service';
import { ConfirmationSheetsService } from './confirmation-sheets.service';

describe('OrdersService', () => {
  let service: OrdersService;
  let prisma: any;
  let access: any;
  let numbering: { nextNumber: jest.Mock };
  let confirmationSheets: { latestIsExecutedFor: jest.Mock };

  const rep: AuthenticatedUser = {
    id: 'emp-1',
    email: 'e@x.com',
    role: Role.EMPLOYEE,
    verticalId: 'v-sales',
  };

  beforeEach(async () => {
    prisma = {
      bid: { findUnique: jest.fn() },
      order: {
        findUnique: jest.fn(),
        findFirst: jest.fn(),
        update: jest.fn(),
        findMany: jest.fn(),
        count: jest.fn(),
      },
      $transaction: jest.fn(),
    };
    access = {
      assertSalesAccess: jest.fn().mockResolvedValue(undefined),
      assertCanAccessOwned: jest.fn().mockResolvedValue(undefined),
      visibleOwnerIds: jest.fn().mockResolvedValue(['emp-1']),
    };
    numbering = { nextNumber: jest.fn().mockResolvedValue('ORD-2026-0001') };
    // The order gate: default to "latest sheet executed" so status-transition
    // tests that don't care about the gate pass; the gate itself has its own
    // e2e coverage.
    confirmationSheets = {
      latestIsExecutedFor: jest.fn().mockResolvedValue(true),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OrdersService,
        { provide: PrismaService, useValue: prisma },
        { provide: SalesAccessService, useValue: access },
        { provide: SalesNumberingService, useValue: numbering },
        { provide: ConfirmationSheetsService, useValue: confirmationSheets },
      ],
    }).compile();

    service = module.get(OrdersService);
  });

  describe('convertFromBid', () => {
    it('rejects converting a bid that is not ACCEPTED', async () => {
      prisma.bid.findUnique.mockResolvedValue({
        id: 'bid-1',
        status: BidStatus.SENT,
        createdById: 'emp-1',
        customerId: 'cust-1',
        lineItems: [],
      });
      await expect(service.convertFromBid('bid-1', rep)).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    it('rejects converting a bid that already has an order', async () => {
      prisma.bid.findUnique.mockResolvedValue({
        id: 'bid-1',
        status: BidStatus.ACCEPTED,
        createdById: 'emp-1',
        customerId: 'cust-1',
        lineItems: [],
      });
      prisma.order.findFirst.mockResolvedValue({ id: 'existing-order' });
      await expect(service.convertFromBid('bid-1', rep)).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    it('copies line items from an ACCEPTED bid into a CONFIRMED order', async () => {
      prisma.bid.findUnique.mockResolvedValue({
        id: 'bid-1',
        status: BidStatus.ACCEPTED,
        createdById: 'emp-1',
        customerId: 'cust-1',
        totalAmount: new Prisma.Decimal(62687500),
        lineItems: [
          {
            productId: 'prod-1',
            quantity: new Prisma.Decimal(500),
            unitPrice: new Prisma.Decimal(125000),
            lineTotal: new Prisma.Decimal(62500000),
          },
        ],
      });
      prisma.order.findFirst.mockResolvedValue(null);

      const orderCreate = jest.fn().mockImplementation(({ data }: any) => ({
        id: 'order-1',
        orderNumber: data.orderNumber,
        bidId: data.bidId,
        customerId: data.customerId,
        ownerId: data.ownerId,
        owner: { firstName: 'Sales', lastName: 'Rep' },
        status: OrderStatus.CONFIRMED,
        totalAmount: data.totalAmount,
        productionRunId: null,
        shipmentId: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        lineItems: data.lineItems.create.map((li: any, i: number) => ({
          ...li,
          id: `oli-${i}`,
          orderId: 'order-1',
          product: { name: `Product ${li.productId}`, sku: `SKU-${i}` },
        })),
      }));
      prisma.$transaction.mockImplementation(async (cb: any) =>
        cb({ order: { create: orderCreate } }),
      );

      const result = await service.convertFromBid('bid-1', rep);
      expect(result.orderNumber).toBe('ORD-2026-0001');
      expect(result.status).toBe(OrderStatus.CONFIRMED);
      expect(result.lineItems?.[0].lineTotal).toBe('62500000');
      expect(result.ownerId).toBe('emp-1');
      // Booked value snapshotted from the accepted bid's total.
      expect(result.totalAmount).toBe('62687500');
    });
  });

  describe('updateStatus', () => {
    it('allows CONFIRMED → IN_PRODUCTION', async () => {
      prisma.order.findUnique.mockResolvedValue({
        id: 'order-1',
        status: OrderStatus.CONFIRMED,
        ownerId: 'emp-1',
        owner: { firstName: 'Sales', lastName: 'Rep' },
        lineItems: [],
      });
      prisma.order.update.mockResolvedValue({
        id: 'order-1',
        orderNumber: 'ORD-2026-0001',
        bidId: null,
        customerId: 'cust-1',
        status: OrderStatus.IN_PRODUCTION,
        totalAmount: new Prisma.Decimal(62687500),
        productionRunId: null,
        shipmentId: null,
        ownerId: 'emp-1',
        owner: { firstName: 'Sales', lastName: 'Rep' },
        lineItems: [],
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      const result = await service.updateStatus(
        'order-1',
        OrderStatus.IN_PRODUCTION,
        rep,
      );
      expect(result.status).toBe(OrderStatus.IN_PRODUCTION);
    });

    it('rejects an illegal skip (CONFIRMED → DELIVERED)', async () => {
      prisma.order.findUnique.mockResolvedValue({
        id: 'order-1',
        status: OrderStatus.CONFIRMED,
        ownerId: 'emp-1',
        owner: { firstName: 'Sales', lastName: 'Rep' },
        lineItems: [],
      });
      await expect(
        service.updateStatus('order-1', OrderStatus.DELIVERED, rep),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejects any transition out of a terminal DELIVERED state', async () => {
      prisma.order.findUnique.mockResolvedValue({
        id: 'order-1',
        status: OrderStatus.DELIVERED,
        ownerId: 'emp-1',
        owner: { firstName: 'Sales', lastName: 'Rep' },
        lineItems: [],
      });
      await expect(
        service.updateStatus('order-1', OrderStatus.CANCELLED, rep),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('vertical-wide read access', () => {
    it('findAll applies NO owner filter (any Sales staff sees all orders)', async () => {
      prisma.$transaction.mockResolvedValue([[], 0]);

      await service.findAll({ page: 1, limit: 20, skip: 0 } as any, rep);

      const whereArg = prisma.order.findMany.mock.calls[0][0].where;
      expect(whereArg).toEqual({});
      expect(access.visibleOwnerIds).not.toHaveBeenCalled();
    });

    it('findOne returns a peer-owned order without an ownership check', async () => {
      prisma.order.findUnique.mockResolvedValue({
        id: 'order-peer',
        orderNumber: 'ORD-2026-0009',
        bidId: 'bid-9',
        customerId: 'cust-9',
        status: OrderStatus.CONFIRMED,
        totalAmount: new Prisma.Decimal('100'),
        productionRunId: null,
        shipmentId: null,
        ownerId: 'other-emp',
        owner: { firstName: 'Peer', lastName: 'Rep' },
        lineItems: [],
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const result = await service.findOne('order-peer', rep);

      expect(result.id).toBe('order-peer');
      expect(access.assertCanAccessOwned).not.toHaveBeenCalled();
    });

    it('updateStatus still enforces the owner check (writes unchanged)', async () => {
      prisma.order.findUnique.mockResolvedValue({
        id: 'order-peer',
        status: OrderStatus.CONFIRMED,
        ownerId: 'other-emp',
        owner: { firstName: 'Peer', lastName: 'Rep' },
        lineItems: [],
      });
      access.assertCanAccessOwned.mockRejectedValue(
        new Error('outside your team'),
      );

      await expect(
        service.updateStatus('order-peer', OrderStatus.IN_PRODUCTION, rep),
      ).rejects.toThrow('outside your team');
      expect(access.assertCanAccessOwned).toHaveBeenCalledWith(
        rep,
        'other-emp',
      );
    });
  });
});
