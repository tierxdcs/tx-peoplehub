import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { BidStatus, Prisma, Role, SalesTaxType } from '@prisma/client';
import { PrismaService } from '../../core/database/prisma.service';
import { AuthenticatedUser } from '../../common/decorators/current-user.decorator';
import { BidsService } from './bids.service';
import { SalesAccessService } from './common/sales-access.service';
import { SalesNumberingService } from './common/sales-numbering.service';
import { ApprovalRoutingService } from './common/approval-routing.service';
import { TaxConfigService } from './tax-config.service';
import { BidAssessmentsService } from './bid-assessments.service';

describe('BidsService', () => {
  let service: BidsService;
  let prisma: any;
  let access: any;
  let numbering: { nextNumber: jest.Mock };
  let approvalRouting: {
    resolveApprover: jest.Mock;
    assertCanActOnBid: jest.Mock;
  };
  let taxConfig: { findEffective: jest.Mock };
  let bidAssessments: { latestApprovedFor: jest.Mock };

  const rep: AuthenticatedUser = {
    id: 'emp-1',
    email: 'e@x.com',
    role: Role.EMPLOYEE,
    verticalId: 'v-sales',
  };

  beforeEach(async () => {
    prisma = {
      opportunity: { findUnique: jest.fn() },
      customer: { findUnique: jest.fn() },
      product: { findMany: jest.fn() },
      bid: {
        findUnique: jest.fn(),
        findMany: jest.fn(),
        count: jest.fn(),
        update: jest.fn(),
      },
      $transaction: jest.fn(),
    };
    access = {
      assertSalesAccess: jest.fn().mockResolvedValue(undefined),
      assertCanAccessOwned: jest.fn().mockResolvedValue(undefined),
      visibleOwnerIds: jest.fn().mockResolvedValue(['emp-1']),
    };
    numbering = { nextNumber: jest.fn().mockResolvedValue('BID-2026-0001') };
    approvalRouting = {
      resolveApprover: jest.fn(),
      assertCanActOnBid: jest.fn().mockResolvedValue(undefined),
    };
    taxConfig = { findEffective: jest.fn() };
    // Default: the Bid/No-Bid gate is satisfied, so existing create tests
    // exercise the money/tax logic. The gate itself is covered separately.
    bidAssessments = {
      latestApprovedFor: jest.fn().mockResolvedValue(true),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BidsService,
        { provide: PrismaService, useValue: prisma },
        { provide: SalesAccessService, useValue: access },
        { provide: SalesNumberingService, useValue: numbering },
        { provide: ApprovalRoutingService, useValue: approvalRouting },
        { provide: TaxConfigService, useValue: taxConfig },
        { provide: BidAssessmentsService, useValue: bidAssessments },
      ],
    }).compile();

    service = module.get(BidsService);
  });

  describe('create — money computation', () => {
    beforeEach(() => {
      prisma.opportunity.findUnique.mockResolvedValue({ id: 'opp-1' });
      prisma.customer.findUnique.mockResolvedValue({
        id: 'cust-1',
        billingAddress: { state: 'Maharashtra' },
      });
      prisma.product.findMany.mockResolvedValue([
        { id: 'prod-1', unitPrice: new Prisma.Decimal(125000) },
      ]);
      taxConfig.findEffective.mockResolvedValue({
        rate: new Prisma.Decimal(18),
      });
      // $transaction passes a tx client; echo back the create() args' data.
      prisma.$transaction.mockImplementation(async (cb: any) =>
        cb({
          bid: {
            create: jest.fn().mockImplementation(({ data }: any) => ({
              ...data,
              id: 'bid-1',
              status: BidStatus.DRAFT,
              approverId: null,
              approvedAt: null,
              approverComments: null,
              tenderReferenceNumber: data.tenderReferenceNumber ?? null,
              technicalSpecification: data.technicalSpecification ?? null,
              attachments: data.attachments ?? null,
              createdAt: new Date(),
              updatedAt: new Date(),
              lineItems: data.lineItems.create.map((li: any, i: number) => ({
                ...li,
                id: `li-${i}`,
                bidId: 'bid-1',
                product: { name: `Product ${li.productId}`, sku: `SKU-${i}` },
              })),
              amcCharges: (data.amcCharges?.create ?? []).map(
                (charge: any, i: number) => ({
                  ...charge,
                  id: `amc-${i}`,
                  bidId: 'bid-1',
                  createdAt: new Date(),
                  updatedAt: new Date(),
                }),
              ),
            })),
          },
        }),
      );
    });

    it('snapshots product price and computes subtotal/discount/tax/total (inter-state IGST)', async () => {
      const result = await service.create(
        {
          opportunityId: 'opp-1',
          customerId: 'cust-1',
          validUntil: '2026-10-31',
          discountPercent: 15,
          lineItems: [{ productId: 'prod-1', quantity: 500 }],
        },
        rep,
      );
      // 500 * 125000 = 62,500,000 subtotal
      expect(result.subtotal).toBe('62500000');
      // 15% discount = 9,375,000
      expect(result.discountAmount).toBe('9375000');
      // taxable 53,125,000 * 18% = 9,562,500
      expect(result.taxType).toBe(SalesTaxType.IGST);
      expect(result.taxAmount).toBe('9562500');
      // total = 53,125,000 + 9,562,500 = 62,687,500
      expect(result.totalAmount).toBe('62687500');
      expect(result.amcTotal).toBe('0');
      expect(result.grandTotal).toBe(result.totalAmount);
      // price was snapshotted from the product, not passed in
      expect(result.lineItems?.[0].unitPrice).toBe('125000');
    });

    it('applies a per-line discount before the bid-level discount', async () => {
      const result = await service.create(
        {
          opportunityId: 'opp-1',
          customerId: 'cust-1',
          validUntil: '2026-10-31',
          lineItems: [
            { productId: 'prod-1', quantity: 10, lineDiscountPercent: 10 },
          ],
        },
        rep,
      );
      // gross 1,250,000; line -10% => 1,125,000 subtotal; no bid discount; 18% tax
      expect(result.subtotal).toBe('1125000');
      expect(result.taxAmount).toBe('202500');
      expect(result.totalAmount).toBe('1327500');
    });

    it('leaves tax at 0 when no TaxConfig is effective', async () => {
      taxConfig.findEffective.mockResolvedValue(null);
      const result = await service.create(
        {
          opportunityId: 'opp-1',
          customerId: 'cust-1',
          validUntil: '2026-10-31',
          lineItems: [{ productId: 'prod-1', quantity: 1 }],
        },
        rep,
      );
      expect(result.taxType).toBeNull();
      expect(result.taxAmount).toBe('0');
      expect(result.totalAmount).toBe('125000');
    });

    it('adds only entered AMC years after tax without taxing them', async () => {
      const result = await service.create(
        {
          opportunityId: 'opp-1',
          customerId: 'cust-1',
          validUntil: '2026-10-31',
          lineItems: [{ productId: 'prod-1', quantity: 1 }],
          amcCharges: [
            { yearNumber: 2, amount: 10000 },
            { yearNumber: 4, amount: 25000.5 },
          ],
        },
        rep,
      );

      // Product 125,000 + 18% GST = 147,500. AMC remains flat and untaxed.
      expect(result.taxAmount).toBe('22500');
      expect(result.totalAmount).toBe('147500');
      expect(result.amcTotal).toBe('35000.5');
      expect(result.grandTotal).toBe('182500.5');
      expect(result.amcCharges).toEqual([
        expect.objectContaining({ yearNumber: 2, amount: '10000' }),
        expect.objectContaining({ yearNumber: 4, amount: '25000.5' }),
      ]);
    });

    it('rejects a bid with no line items', async () => {
      await expect(
        service.create(
          {
            opportunityId: 'opp-1',
            customerId: 'cust-1',
            validUntil: '2026-10-31',
            lineItems: [],
          },
          rep,
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('blocks bid creation when no approved Bid/No-Bid assessment exists', async () => {
      bidAssessments.latestApprovedFor.mockResolvedValue(false);
      await expect(
        service.create(
          {
            opportunityId: 'opp-1',
            customerId: 'cust-1',
            validUntil: '2026-10-31',
            lineItems: [{ productId: 'prod-1', quantity: 1 }],
          },
          rep,
        ),
      ).rejects.toThrow(/approved Bid\/No-Bid assessment/);
      expect(bidAssessments.latestApprovedFor).toHaveBeenCalledWith('opp-1');
    });

    it.each([
      'INFRA',
      'EDGE',
      'HYPERSCALE',
      'MOD',
      'INTELLIGENCE',
      'SERVICES',
    ])(
      'allows products from every business unit for a %s opportunity',
      async (opportunityBusinessUnitId) => {
        prisma.opportunity.findUnique.mockResolvedValue({
          id: 'opp-1',
          businessUnitId: opportunityBusinessUnitId,
        });
        prisma.product.findMany.mockResolvedValue([
          {
            id: 'prod-1',
            sku: 'CROSS-SELL-1',
            businessUnitId:
              opportunityBusinessUnitId === 'SERVICES'
                ? 'EDGE'
                : 'SERVICES',
            unitPrice: new Prisma.Decimal(125000),
          },
        ]);

        await expect(
          service.create(
            {
              opportunityId: 'opp-1',
              customerId: 'cust-1',
              validUntil: '2026-10-31',
              lineItems: [{ productId: 'prod-1', quantity: 1 }],
            },
            rep,
          ),
        ).resolves.toBeDefined();
      },
    );
  });

  describe('submit — discount approval routing', () => {
    it('routes >10% discount to PENDING_APPROVAL with the resolved approver', async () => {
      prisma.bid.findUnique.mockResolvedValue({
        id: 'bid-1',
        status: BidStatus.DRAFT,
        discountPercent: new Prisma.Decimal(15),
        createdById: 'emp-1',
        lineItems: [],
      });
      approvalRouting.resolveApprover.mockResolvedValue('mgr-1');
      prisma.bid.update.mockResolvedValue({
        id: 'bid-1',
        status: BidStatus.PENDING_APPROVAL,
        discountPercent: new Prisma.Decimal(15),
        createdById: 'emp-1',
        approverId: 'mgr-1',
        subtotal: new Prisma.Decimal(0),
        discountAmount: new Prisma.Decimal(0),
        taxAmount: new Prisma.Decimal(0),
        totalAmount: new Prisma.Decimal(0),
        validUntil: new Date(),
        lineItems: [],
        createdAt: new Date(),
        updatedAt: new Date(),
        approvedAt: null,
        approverComments: null,
        tenderReferenceNumber: null,
        technicalSpecification: null,
        attachments: null,
        taxType: null,
        taxRate: null,
      });

      const result = await service.submit('bid-1', rep);
      expect(result.status).toBe(BidStatus.PENDING_APPROVAL);
      const updateArg = prisma.bid.update.mock.calls[0][0];
      expect(updateArg.data.status).toBe(BidStatus.PENDING_APPROVAL);
      expect(updateArg.data.approverId).toBe('mgr-1');
    });

    it('sends a <=10% discount bid straight to SENT (no approval)', async () => {
      prisma.bid.findUnique.mockResolvedValue({
        id: 'bid-2',
        status: BidStatus.DRAFT,
        discountPercent: new Prisma.Decimal(5),
        createdById: 'emp-1',
        lineItems: [],
      });
      prisma.bid.update.mockResolvedValue({
        id: 'bid-2',
        status: BidStatus.SENT,
        discountPercent: new Prisma.Decimal(5),
        createdById: 'emp-1',
        approverId: null,
        subtotal: new Prisma.Decimal(0),
        discountAmount: new Prisma.Decimal(0),
        taxAmount: new Prisma.Decimal(0),
        totalAmount: new Prisma.Decimal(0),
        validUntil: new Date(),
        lineItems: [],
        createdAt: new Date(),
        updatedAt: new Date(),
        approvedAt: null,
        approverComments: null,
        tenderReferenceNumber: null,
        technicalSpecification: null,
        attachments: null,
        taxType: null,
        taxRate: null,
      });

      const result = await service.submit('bid-2', rep);
      expect(result.status).toBe(BidStatus.SENT);
      expect(approvalRouting.resolveApprover).not.toHaveBeenCalled();
    });

    it('rejects submitting a bid that is neither DRAFT nor REJECTED', async () => {
      prisma.bid.findUnique.mockResolvedValue({
        id: 'bid-3',
        status: BidStatus.ACCEPTED,
        discountPercent: new Prisma.Decimal(0),
        createdById: 'emp-1',
        lineItems: [],
      });
      await expect(service.submit('bid-3', rep)).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });
  });

  describe('markStatus — transition guard', () => {
    it('rejects an illegal transition (DRAFT → ACCEPTED)', async () => {
      prisma.bid.findUnique.mockResolvedValue({
        id: 'bid-1',
        status: BidStatus.DRAFT,
        createdById: 'emp-1',
        lineItems: [],
      });
      await expect(
        service.markStatus('bid-1', BidStatus.ACCEPTED, rep),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('findPendingApproval', () => {
    it('scopes a MANAGER to bids assigned to them (approverId = self)', async () => {
      const manager: AuthenticatedUser = {
        id: 'mgr-1',
        email: 'm@x.com',
        role: Role.MANAGER,
        verticalId: 'v-sales',
      };
      prisma.bid.findMany.mockResolvedValue([]);
      prisma.bid.count.mockResolvedValue(0);
      prisma.$transaction.mockImplementation(async () => [[], 0]);

      await service.findPendingApproval(
        { page: 1, limit: 20, skip: 0 } as any,
        manager,
      );

      const whereArg = prisma.bid.findMany.mock.calls[0][0].where;
      expect(whereArg.status).toBe(BidStatus.PENDING_APPROVAL);
      expect(whereArg.approverId).toBe('mgr-1');
    });

    it('shows all PENDING_APPROVAL bids to an Admin (no approver filter)', async () => {
      const admin: AuthenticatedUser = {
        id: 'ad-1',
        email: 'a@x.com',
        role: Role.ADMIN,
        verticalId: null,
      };
      prisma.bid.findMany.mockResolvedValue([]);
      prisma.bid.count.mockResolvedValue(0);
      prisma.$transaction.mockImplementation(async () => [[], 0]);

      await service.findPendingApproval(
        { page: 1, limit: 20, skip: 0 } as any,
        admin,
      );

      const whereArg = prisma.bid.findMany.mock.calls[0][0].where;
      expect(whereArg.status).toBe(BidStatus.PENDING_APPROVAL);
      expect(whereArg.approverId).toBeUndefined();
    });
  });

  describe('vertical-wide read access', () => {
    it('findAll applies NO owner/creator filter (any Sales staff sees all bids)', async () => {
      prisma.$transaction.mockResolvedValue([[], 0]);

      await service.findAll({ page: 1, limit: 20, skip: 0 } as any, rep);

      const whereArg = prisma.bid.findMany.mock.calls[0][0].where;
      expect(whereArg).toEqual({});
      // Viewing all bids is not the same as being able to act on them.
      expect(access.visibleOwnerIds).not.toHaveBeenCalled();
    });

    it('findOne returns a peer-created bid without an ownership check', async () => {
      prisma.bid.findUnique.mockResolvedValue({
        id: 'bid-peer',
        bidNumber: 'BID-2026-0009',
        opportunityId: 'opp-9',
        customerId: 'cust-9',
        status: BidStatus.DRAFT,
        validUntil: new Date(),
        tenderReferenceNumber: null,
        technicalSpecification: null,
        attachments: null,
        subtotal: new Prisma.Decimal('100'),
        discountPercent: new Prisma.Decimal('0'),
        discountAmount: new Prisma.Decimal('0'),
        taxType: null,
        taxRate: null,
        taxAmount: new Prisma.Decimal('0'),
        totalAmount: new Prisma.Decimal('100'),
        createdById: 'other-emp',
        approverId: null,
        approvedAt: null,
        approverComments: null,
        lineItems: [],
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const result = await service.findOne('bid-peer', rep);

      expect(result.id).toBe('bid-peer');
      expect(access.assertCanAccessOwned).not.toHaveBeenCalled();
    });

    it('submit still enforces the creator/owner check (writes unchanged)', async () => {
      prisma.bid.findUnique.mockResolvedValue({
        id: 'bid-peer',
        status: BidStatus.DRAFT,
        createdById: 'other-emp',
        discountPercent: new Prisma.Decimal('0'),
        lineItems: [],
      });
      access.assertCanAccessOwned.mockRejectedValue(
        new Error('outside your team'),
      );

      await expect(service.submit('bid-peer', rep)).rejects.toThrow(
        'outside your team',
      );
      expect(access.assertCanAccessOwned).toHaveBeenCalledWith(
        rep,
        'other-emp',
      );
    });
  });
});
