import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import {
  BidStatus,
  OrderFinalQcStatus,
  OrderStatus,
  OrderType,
  Prisma,
  Role,
} from '@prisma/client';
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
      orderLineItem: {
        deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
        update: jest.fn().mockResolvedValue({}),
        create: jest.fn().mockResolvedValue({}),
      },
      product: { findMany: jest.fn(), findUnique: jest.fn() },
      customer: { findUnique: jest.fn() },
      businessUnit: { findUnique: jest.fn() },
      $transaction: jest.fn(),
    };
    access = {
      assertSalesAccess: jest.fn().mockResolvedValue(undefined),
      assertCanAccessOwned: jest.fn().mockResolvedValue(undefined),
      assertCanCreateInternalOrder: jest.fn().mockResolvedValue(undefined),
      // Default the read-scope gate to full (Sales) access so existing
      // findAll/findOne tests keep their vertical-wide behavior.
      hasSalesAccess: jest.fn().mockResolvedValue(true),
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

    it('rejects converting a bid with an unresolved ad-hoc line item', async () => {
      prisma.bid.findUnique.mockResolvedValue({
        id: 'bid-1',
        status: BidStatus.ACCEPTED,
        createdById: 'emp-1',
        customerId: 'cust-1',
        totalAmount: new Prisma.Decimal(1000),
        amcCharges: [],
        lineItems: [
          {
            productId: 'prod-1',
            quantity: new Prisma.Decimal(1),
            unitPrice: new Prisma.Decimal(1000),
            lineTotal: new Prisma.Decimal(1000),
          },
          {
            // Unresolved ad-hoc placeholder — must block conversion.
            productId: null,
            quantity: new Prisma.Decimal(1),
            unitPrice: new Prisma.Decimal(500),
            lineTotal: new Prisma.Decimal(500),
          },
        ],
      });
      prisma.order.findFirst.mockResolvedValue(null);

      await expect(service.convertFromBid('bid-1', rep)).rejects.toThrow(
        /awaiting product setup/,
      );
      // No order transaction should run while a placeholder remains.
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('rejects a customer-BOM product until R&D releases its BOM', async () => {
      prisma.bid.findUnique.mockResolvedValue({
        id: 'bid-1',
        status: BidStatus.ACCEPTED,
        createdById: 'emp-1',
        customerId: 'cust-1',
        totalAmount: new Prisma.Decimal(1000),
        amcCharges: [],
        lineItems: [
          {
            productId: 'prod-1',
            product: {
              customerBomIntake: { id: 'intake-1', bom: { status: 'DRAFT' } },
            },
            quantity: new Prisma.Decimal(1),
            unitPrice: new Prisma.Decimal(1000),
            lineTotal: new Prisma.Decimal(1000),
          },
        ],
      });
      prisma.order.findFirst.mockResolvedValue(null);

      await expect(service.convertFromBid('bid-1', rep)).rejects.toThrow(
        /awaiting R&D release/,
      );
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('copies line items from an ACCEPTED bid into a CONFIRMED order', async () => {
      prisma.bid.findUnique.mockResolvedValue({
        id: 'bid-1',
        status: BidStatus.ACCEPTED,
        createdById: 'emp-1',
        customerId: 'cust-1',
        totalAmount: new Prisma.Decimal(62687500),
        amcCharges: [
          { yearNumber: 2, amount: new Prisma.Decimal(100000) },
          { yearNumber: 3, amount: new Prisma.Decimal(150000) },
        ],
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
      // Booked value includes flat AMC accepted on the quotation.
      expect(result.totalAmount).toBe('62937500');
    });
  });

  describe('createInternal', () => {
    it('creates a zero-priced INTERNAL order (no bid, no committed value)', async () => {
      prisma.product.findMany.mockResolvedValue([
        { id: 'prod-1' },
        { id: 'prod-2' },
      ]);
      const orderCreate = jest.fn().mockImplementation(({ data }: any) => ({
        id: 'order-int',
        orderNumber: data.orderNumber,
        orderType: data.orderType,
        bidId: data.bidId,
        customerId: data.customerId,
        status: OrderStatus.CONFIRMED,
        totalAmount: data.totalAmount,
        productionRunId: null,
        shipmentId: null,
        ownerId: data.ownerId,
        owner: { firstName: 'Sales', lastName: 'Rep' },
        enquiryCreatorId: null,
        businessUnitId: data.businessUnitId,
        createdAt: new Date(),
        updatedAt: new Date(),
        lineItems: data.lineItems.create.map((li: any, i: number) => ({
          ...li,
          id: `oli-${i}`,
          orderId: 'order-int',
          product: { name: `Product ${li.productId}`, sku: `SKU-${i}` },
        })),
      }));
      prisma.$transaction.mockImplementation(async (cb: any) =>
        cb({ order: { create: orderCreate } }),
      );

      const result = await service.createInternal(
        {
          lineItems: [
            { productId: 'prod-1', quantity: 5 },
            { productId: 'prod-2', quantity: 2 },
          ],
        },
        rep,
      );

      expect(access.assertCanCreateInternalOrder).toHaveBeenCalledWith(rep);
      expect(result.orderType).toBe(OrderType.INTERNAL);
      expect(result.bidId).toBeNull();
      expect(result.totalAmount).toBe('0');
      expect(result.ownerId).toBe('emp-1');
      // Every line carries the real product + quantity but no pricing.
      expect(result.lineItems?.map((li) => li.unitPrice)).toEqual(['0', '0']);
      expect(result.lineItems?.map((li) => li.lineTotal)).toEqual(['0', '0']);
      expect(result.lineItems?.map((li) => li.quantity)).toEqual(['5', '2']);
    });

    it('rejects the same product appearing twice', async () => {
      await expect(
        service.createInternal(
          {
            lineItems: [
              { productId: 'prod-1', quantity: 1 },
              { productId: 'prod-1', quantity: 3 },
            ],
          },
          rep,
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('rejects a line referencing a product that does not exist', async () => {
      prisma.product.findMany.mockResolvedValue([{ id: 'prod-1' }]);
      await expect(
        service.createInternal(
          {
            lineItems: [
              { productId: 'prod-1', quantity: 1 },
              { productId: 'ghost', quantity: 1 },
            ],
          },
          rep,
        ),
      ).rejects.toThrow(/do not exist/);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('creates an unresolved ad-hoc line with zero pricing', async () => {
      prisma.product.findMany.mockResolvedValue([]);
      const orderCreate = jest.fn().mockImplementation(({ data }: any) => ({
        id: 'order-int',
        orderNumber: data.orderNumber,
        orderType: data.orderType,
        bidId: null,
        customerId: null,
        status: OrderStatus.CONFIRMED,
        totalAmount: data.totalAmount,
        productionRunId: null,
        shipmentId: null,
        ownerId: data.ownerId,
        owner: { firstName: 'Sales', lastName: 'Rep' },
        enquiryCreatorId: null,
        businessUnitId: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        lineItems: data.lineItems.create.map((line: any) => ({
          ...line,
          id: 'line-ad-hoc',
          orderId: 'order-int',
          product: null,
        })),
      }));
      prisma.$transaction.mockImplementation(async (cb: any) =>
        cb({ order: { create: orderCreate } }),
      );

      const result = await service.createInternal(
        {
          lineItems: [
            {
              adHocProductName: 'Prototype enclosure',
              adHocDescription: 'First sample for design validation',
              quantity: 2,
            },
          ],
        },
        rep,
      );

      expect(result.lineItems?.[0]).toMatchObject({
        productId: null,
        productName: 'Prototype enclosure',
        productSku: 'Ad-hoc',
        isAdHoc: true,
        unitPrice: '0',
        lineTotal: '0',
      });
    });

    it('enforces exactly one of productId or adHocProductName', async () => {
      await expect(
        service.createInternal(
          {
            lineItems: [
              {
                productId: 'prod-1',
                adHocProductName: 'Conflicting placeholder',
                quantity: 1,
              },
            ],
          },
          rep,
        ),
      ).rejects.toThrow(/exactly one of productId or adHocProductName/);
      await expect(
        service.createInternal({ lineItems: [{ quantity: 1 }] }, rep),
      ).rejects.toThrow(/exactly one of productId or adHocProductName/);
    });
  });

  describe('promoteInternalOrder', () => {
    // A won bid pricing two products; the internal order it's promoted onto
    // carries one of them plus two extra internal-only lines (one with design
    // work, one without).
    function acceptedBid() {
      return {
        id: 'bid-1',
        status: BidStatus.ACCEPTED,
        createdById: 'emp-1',
        customerId: 'cust-1',
        enquiryCreatorId: 'emp-9',
        businessUnitId: 'bu-1',
        totalAmount: new Prisma.Decimal(50000),
        amcCharges: [{ yearNumber: 2, amount: new Prisma.Decimal(5000) }],
        lineItems: [
          {
            productId: 'prod-1',
            quantity: new Prisma.Decimal(1),
            unitPrice: new Prisma.Decimal(100),
            lineTotal: new Prisma.Decimal(100),
          },
          {
            productId: 'prod-2',
            quantity: new Prisma.Decimal(1),
            unitPrice: new Prisma.Decimal(200),
            lineTotal: new Prisma.Decimal(200),
          },
        ],
      };
    }

    function internalOrder() {
      return {
        id: 'order-int',
        orderType: OrderType.INTERNAL,
        bidId: null,
        lineItems: [
          // matched to the bid + confirmed → update in place (tracker survives)
          { id: 'A', productId: 'prod-1', plmTrackers: [] },
          // dropped, but has design work on a split → kept untouched
          { id: 'B', productId: 'prod-3', plmTrackers: [{ id: 'plm-1' }] },
          // dropped, no design work → deleted
          { id: 'C', productId: 'prod-4', plmTrackers: [] },
        ],
      };
    }

    function wireTransaction() {
      const deleteMany = jest.fn().mockResolvedValue({ count: 1 });
      const lineUpdate = jest.fn().mockResolvedValue({});
      const lineCreate = jest.fn().mockResolvedValue({});
      const orderUpdate = jest.fn().mockImplementation(({ data }: any) => ({
        id: 'order-int',
        orderNumber: 'ORD-2026-0007',
        orderType: data.orderType,
        bidId: data.bidId,
        customerId: data.customerId,
        status: OrderStatus.CONFIRMED,
        totalAmount: data.totalAmount,
        productionRunId: null,
        shipmentId: null,
        ownerId: 'emp-1',
        owner: { firstName: 'Sales', lastName: 'Rep' },
        enquiryCreatorId: data.enquiryCreatorId,
        businessUnitId: data.businessUnitId,
        customer: { name: 'Acme' },
        createdAt: new Date(),
        updatedAt: new Date(),
        lineItems: [
          {
            id: 'A',
            orderId: 'order-int',
            productId: 'prod-1',
            quantity: new Prisma.Decimal(10),
            unitPrice: new Prisma.Decimal(100),
            lineTotal: new Prisma.Decimal(1000),
            product: { name: 'P1', sku: 'S1' },
          },
        ],
      }));
      prisma.$transaction.mockImplementation(async (cb: any) =>
        cb({
          orderLineItem: {
            deleteMany,
            update: lineUpdate,
            create: lineCreate,
          },
          order: { update: orderUpdate },
        }),
      );
      return { deleteMany, lineUpdate, lineCreate, orderUpdate };
    }

    it('reconciles lines and flips the order to CUSTOMER with the bid snapshot', async () => {
      prisma.bid.findUnique.mockResolvedValue(acceptedBid());
      prisma.order.findFirst.mockResolvedValue(null);
      prisma.order.findUnique.mockResolvedValue(internalOrder());
      const tx = wireTransaction();

      const result = await service.promoteInternalOrder(
        'bid-1',
        {
          orderId: 'order-int',
          lineItems: [
            { productId: 'prod-1', quantity: 10 }, // matched → update
            { productId: 'prod-2', quantity: 3 }, // new → create
          ],
        },
        rep,
      );

      // Only the untracked dropped line (C) is deleted; the tracked drop (B) is kept.
      expect(tx.deleteMany).toHaveBeenCalledWith({
        where: { id: { in: ['C'] } },
      });
      // Matched line updated in place at the bid price (100 × 10).
      expect(tx.lineUpdate).toHaveBeenCalledWith({
        where: { id: 'A' },
        data: {
          quantity: new Prisma.Decimal(10),
          unitPrice: new Prisma.Decimal(100),
          lineTotal: new Prisma.Decimal(1000),
        },
      });
      // The new bid product is created (200 × 3).
      expect(tx.lineCreate).toHaveBeenCalledTimes(1);
      expect(tx.lineCreate).toHaveBeenCalledWith({
        data: {
          orderId: 'order-int',
          productId: 'prod-2',
          quantity: new Prisma.Decimal(3),
          unitPrice: new Prisma.Decimal(200),
          lineTotal: new Prisma.Decimal(600),
        },
      });
      // Order flips to CUSTOMER, adopts the bid's customer, and books the
      // accepted quotation value incl. flat AMC (50000 + 5000).
      const updateData = tx.orderUpdate.mock.calls[0][0].data;
      expect(updateData.orderType).toBe(OrderType.CUSTOMER);
      expect(updateData.bidId).toBe('bid-1');
      expect(updateData.customerId).toBe('cust-1');
      expect(updateData.totalAmount.toString()).toBe('55000');
      expect(result.orderType).toBe(OrderType.CUSTOMER);
      expect(result.totalAmount).toBe('55000');
    });

    it('rejects a confirmed line that is not part of the won bid', async () => {
      prisma.bid.findUnique.mockResolvedValue(acceptedBid());
      prisma.order.findFirst.mockResolvedValue(null);
      prisma.order.findUnique.mockResolvedValue(internalOrder());

      await expect(
        service.promoteInternalOrder(
          'bid-1',
          {
            orderId: 'order-int',
            lineItems: [
              { productId: 'prod-1', quantity: 1 },
              { productId: 'prod-3', quantity: 1 }, // internal-only, no bid price
            ],
          },
          rep,
        ),
      ).rejects.toThrow(/not part of the won bid/);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('refuses to promote an order that is not INTERNAL', async () => {
      prisma.bid.findUnique.mockResolvedValue(acceptedBid());
      prisma.order.findFirst.mockResolvedValue(null);
      prisma.order.findUnique.mockResolvedValue({
        id: 'order-int',
        orderType: OrderType.CUSTOMER,
        bidId: null,
        lineItems: [],
      });

      await expect(
        service.promoteInternalOrder(
          'bid-1',
          {
            orderId: 'order-int',
            lineItems: [{ productId: 'prod-1', quantity: 1 }],
          },
          rep,
        ),
      ).rejects.toThrow(/internal order can be promoted/);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('blocks promotion while an internal-order ad-hoc line is unresolved', async () => {
      prisma.bid.findUnique.mockResolvedValue(acceptedBid());
      prisma.order.findFirst.mockResolvedValue(null);
      prisma.order.findUnique.mockResolvedValue({
        ...internalOrder(),
        lineItems: [
          ...internalOrder().lineItems,
          {
            id: 'D',
            productId: null,
            adHocProductName: 'Prototype',
            plmTrackers: [{ id: 'plm-2' }],
          },
        ],
      });

      await expect(
        service.promoteInternalOrder(
          'bid-1',
          {
            orderId: 'order-int',
            lineItems: [{ productId: 'prod-1', quantity: 1 }],
          },
          rep,
        ),
      ).rejects.toThrow(/awaiting product setup/);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });
  });

  describe('resolveLineItem', () => {
    it('resolves an ad-hoc internal-order line in place', async () => {
      prisma.order.findUnique
        .mockResolvedValueOnce({
          id: 'order-int',
          orderType: OrderType.INTERNAL,
          bidId: null,
          lineItems: [
            { id: 'line-1', productId: null, adHocProductName: 'Prototype' },
          ],
          owner: { firstName: 'Sales', lastName: 'Rep' },
        })
        .mockResolvedValueOnce({
          id: 'order-int',
          orderNumber: 'ORD-2026-0001',
          orderType: OrderType.INTERNAL,
          bidId: null,
          customerId: null,
          status: OrderStatus.CONFIRMED,
          totalAmount: new Prisma.Decimal(0),
          productionRunId: null,
          shipmentId: null,
          ownerId: 'emp-1',
          owner: { firstName: 'Sales', lastName: 'Rep' },
          enquiryCreatorId: null,
          businessUnitId: null,
          lineItems: [
            {
              id: 'line-1',
              orderId: 'order-int',
              productId: 'prod-1',
              product: { name: 'Formal product', sku: 'FG-001' },
              adHocProductName: null,
              adHocDescription: null,
              quantity: new Prisma.Decimal(1),
              unitPrice: new Prisma.Decimal(0),
              lineTotal: new Prisma.Decimal(0),
              plmTrackers: [{ id: 'plm-1' }],
            },
          ],
          createdAt: new Date(),
          updatedAt: new Date(),
        });
      prisma.product.findUnique.mockResolvedValue({
        id: 'prod-1',
        isActive: true,
      });

      const result = await service.resolveLineItem(
        'order-int',
        'line-1',
        { productId: 'prod-1' },
        rep,
      );

      expect(prisma.orderLineItem.update).toHaveBeenCalledWith({
        where: { id: 'line-1' },
        data: {
          productId: 'prod-1',
          adHocProductName: null,
          adHocDescription: null,
        },
      });
      expect(result.lineItems?.[0].hasPlmTracker).toBe(true);
      expect(result.lineItems?.[0].isAdHoc).toBe(false);
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
        finalQcStatus: OrderFinalQcStatus.CLEARED,
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
      expect(result.finalQcStatus).toBe(OrderFinalQcStatus.CLEARED);
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
