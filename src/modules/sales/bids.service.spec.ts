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
      product: { findMany: jest.fn(), findUnique: jest.fn() },
      bid: {
        findUnique: jest.fn(),
        findMany: jest.fn(),
        count: jest.fn(),
        update: jest.fn(),
      },
      bidLineItem: { update: jest.fn(), findMany: jest.fn() },
      $transaction: jest.fn(),
    };
    access = {
      assertSalesAccess: jest.fn().mockResolvedValue(undefined),
      assertCanAccessOwned: jest.fn().mockResolvedValue(undefined),
      visibleOwnerIds: jest.fn().mockResolvedValue(['emp-1']),
      isSalesStaff: jest.fn().mockResolvedValue(true),
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

    it('marks up the unit price by a per-line sales margin', async () => {
      const result = await service.create(
        {
          opportunityId: 'opp-1',
          customerId: 'cust-1',
          validUntil: '2026-10-31',
          lineItems: [{ productId: 'prod-1', quantity: 10, marginPercent: 20 }],
        },
        rep,
      );
      // 125,000 base × 1.20 margin = 150,000 quoted unit price.
      expect(result.lineItems?.[0].unitPrice).toBe('150000');
      expect(result.lineItems?.[0].marginPercent).toBe('20');
      expect(result.marginPercent).toBe('0');
      // 10 × 150,000 = 1,500,000 subtotal; 18% tax = 270,000.
      expect(result.subtotal).toBe('1500000');
      expect(result.taxAmount).toBe('270000');
      expect(result.totalAmount).toBe('1770000');
    });

    it('stacks the bid-level margin on the line margin, then applies discounts', async () => {
      const result = await service.create(
        {
          opportunityId: 'opp-1',
          customerId: 'cust-1',
          validUntil: '2026-10-31',
          marginPercent: 10, // bid-level markup
          discountPercent: 5, // bid-level discount
          lineItems: [
            {
              productId: 'prod-1',
              quantity: 2,
              marginPercent: 20, // per-line markup
              lineDiscountPercent: 10,
            },
          ],
        },
        rep,
      );
      // Unit: 125,000 × 1.20 (line) × 1.10 (bid) = 165,000.
      expect(result.lineItems?.[0].unitPrice).toBe('165000');
      expect(result.lineItems?.[0].marginPercent).toBe('20');
      expect(result.marginPercent).toBe('10');
      // gross 330,000; line −10% → 297,000 subtotal.
      expect(result.subtotal).toBe('297000');
      // bid −5% → discount 14,850; taxable 282,150; 18% tax = 50,787.
      expect(result.discountAmount).toBe('14850');
      expect(result.taxAmount).toBe('50787');
      expect(result.totalAmount).toBe('332937');
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

    it.each(['INFRA', 'EDGE', 'HYPERSCALE', 'MOD', 'INTELLIGENCE', 'SERVICES'])(
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
              opportunityBusinessUnitId === 'SERVICES' ? 'EDGE' : 'SERVICES',
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

  describe('create — ad-hoc line items', () => {
    beforeEach(() => {
      prisma.opportunity.findUnique.mockResolvedValue({ id: 'opp-1' });
      prisma.customer.findUnique.mockResolvedValue({
        id: 'cust-1',
        billingAddress: { state: 'Karnataka' },
      });
      prisma.product.findMany.mockResolvedValue([
        { id: 'prod-1', unitPrice: new Prisma.Decimal(1000) },
      ]);
      taxConfig.findEffective.mockResolvedValue(null);
      // Realistic echo: a line's `product` is populated only when productId is
      // set, so the toEntity ad-hoc fallback is genuinely exercised.
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
              tenderReferenceNumber: null,
              technicalSpecification: null,
              attachments: null,
              createdAt: new Date(),
              updatedAt: new Date(),
              lineItems: data.lineItems.create.map((li: any, i: number) => ({
                ...li,
                id: `li-${i}`,
                bidId: 'bid-1',
                product: li.productId
                  ? {
                      name: `Product ${li.productId}`,
                      sku: `SKU-${i}`,
                      description: 'catalog desc',
                      unitOfMeasure: 'each',
                    }
                  : null,
              })),
              amcCharges: [],
            })),
          },
        }),
      );
    });

    it('creates an ad-hoc line using the typed unit price and stores the placeholder', async () => {
      const result = await service.create(
        {
          opportunityId: 'opp-1',
          customerId: 'cust-1',
          validUntil: '2026-10-31',
          lineItems: [
            {
              adHocProductName: 'Custom Busbar 400A',
              adHocDescription: 'Tinned copper, 400A rating',
              unitPrice: 2500,
              quantity: 4,
            },
          ],
        },
        rep,
      );

      const line = result.lineItems?.[0];
      expect(line?.isAdHoc).toBe(true);
      expect(line?.productId).toBeNull();
      expect(line?.productSku).toBeNull();
      // Display fields fall back to the ad-hoc placeholder.
      expect(line?.productName).toBe('Custom Busbar 400A');
      expect(line?.productDescription).toBe('Tinned copper, 400A rating');
      expect(line?.unitPrice).toBe('2500');
      // 4 * 2500 = 10,000; no tax config → total equals subtotal.
      expect(line?.lineTotal).toBe('10000');
      expect(result.subtotal).toBe('10000');
    });

    it('marks up an ad-hoc line and rounds the quoted unit price to 2 dp', async () => {
      const result = await service.create(
        {
          opportunityId: 'opp-1',
          customerId: 'cust-1',
          validUntil: '2026-10-31',
          lineItems: [
            {
              adHocProductName: 'Custom bracket',
              unitPrice: 100.1,
              quantity: 1,
              marginPercent: 7,
            },
          ],
        },
        rep,
      );
      const line = result.lineItems?.[0];
      // 100.10 × 1.07 = 107.107 → ROUND_HALF_UP to 107.11.
      expect(line?.unitPrice).toBe('107.11');
      expect(line?.marginPercent).toBe('7');
      expect(result.subtotal).toBe('107.11');
    });

    it('accepts a mix of real-product and ad-hoc lines in one bid', async () => {
      const result = await service.create(
        {
          opportunityId: 'opp-1',
          customerId: 'cust-1',
          validUntil: '2026-10-31',
          lineItems: [
            { productId: 'prod-1', quantity: 2 },
            { adHocProductName: 'One-off part', unitPrice: 500, quantity: 1 },
          ],
        },
        rep,
      );

      const [real, adHoc] = result.lineItems ?? [];
      expect(real.isAdHoc).toBe(false);
      expect(real.productId).toBe('prod-1');
      expect(real.unitPrice).toBe('1000');
      expect(adHoc.isAdHoc).toBe(true);
      expect(adHoc.productName).toBe('One-off part');
      // 2*1000 + 1*500 = 2,500
      expect(result.subtotal).toBe('2500');
    });

    it('rejects a line that sets neither productId nor adHocProductName', async () => {
      await expect(
        service.create(
          {
            opportunityId: 'opp-1',
            customerId: 'cust-1',
            validUntil: '2026-10-31',
            lineItems: [{ quantity: 1 } as any],
          },
          rep,
        ),
      ).rejects.toThrow(/exactly one of productId or adHocProductName/);
    });

    it('rejects a line that sets both productId and adHocProductName', async () => {
      await expect(
        service.create(
          {
            opportunityId: 'opp-1',
            customerId: 'cust-1',
            validUntil: '2026-10-31',
            lineItems: [
              {
                productId: 'prod-1',
                adHocProductName: 'Also ad-hoc',
                unitPrice: 100,
                quantity: 1,
              },
            ],
          },
          rep,
        ),
      ).rejects.toThrow(/exactly one of productId or adHocProductName/);
    });

    it('rejects an ad-hoc line with no unit price', async () => {
      await expect(
        service.create(
          {
            opportunityId: 'opp-1',
            customerId: 'cust-1',
            validUntil: '2026-10-31',
            lineItems: [{ adHocProductName: 'Missing price', quantity: 1 }],
          },
          rep,
        ),
      ).rejects.toThrow(/requires a unitPrice/);
    });
  });

  describe('resolveLineItem — commit an ad-hoc placeholder to a real product', () => {
    const adHocBid = () => ({
      id: 'bid-1',
      bidNumber: 'BID-2026-0001',
      opportunityId: 'opp-1',
      customerId: 'cust-1',
      status: BidStatus.ACCEPTED,
      validUntil: new Date(),
      tenderReferenceNumber: null,
      quotationSubject: null,
      technicalSpecification: null,
      attachments: null,
      subtotal: new Prisma.Decimal(1000),
      discountPercent: new Prisma.Decimal(0),
      discountAmount: new Prisma.Decimal(0),
      taxType: null,
      taxRate: null,
      taxAmount: new Prisma.Decimal(0),
      totalAmount: new Prisma.Decimal(1000),
      createdById: 'emp-1',
      enquiryCreatorId: 'emp-1',
      businessUnitId: 'EDGE',
      approverId: null,
      approvedAt: null,
      approverComments: null,
      approverSignatureTextSnapshot: null,
      approverSignatureFontSnapshot: null,
      orders: [],
      lineItems: [
        {
          id: 'li-0',
          bidId: 'bid-1',
          productId: null,
          adHocProductName: 'Custom part',
          adHocDescription: 'spec',
          quantity: new Prisma.Decimal(1),
          unitPrice: new Prisma.Decimal(1000),
          lineDiscountPercent: null,
          lineTotal: new Prisma.Decimal(1000),
          product: null,
        },
      ],
      amcCharges: [],
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    it('links the product, clears the ad-hoc fields, and preserves unitPrice/lineTotal', async () => {
      prisma.bid.findUnique.mockResolvedValue(adHocBid());
      prisma.product.findUnique.mockResolvedValue({
        id: 'prod-9',
        isActive: true,
      });
      prisma.bidLineItem.update.mockResolvedValue({});

      await service.resolveLineItem(
        'bid-1',
        'li-0',
        { productId: 'prod-9' },
        rep,
      );

      const updateArg = prisma.bidLineItem.update.mock.calls[0][0];
      expect(updateArg.where).toEqual({ id: 'li-0' });
      expect(updateArg.data).toEqual({
        productId: 'prod-9',
        adHocProductName: null,
        adHocDescription: null,
      });
      // unitPrice/lineTotal are NOT part of the update — the quote is preserved.
      expect(updateArg.data.unitPrice).toBeUndefined();
      expect(updateArg.data.lineTotal).toBeUndefined();
    });

    it('rejects resolving once the bid has been converted to an order', async () => {
      prisma.bid.findUnique.mockResolvedValue({
        ...adHocBid(),
        orders: [{ id: 'ord-1' }],
      });

      await expect(
        service.resolveLineItem('bid-1', 'li-0', { productId: 'prod-9' }, rep),
      ).rejects.toThrow(/already been converted/);
      expect(prisma.bidLineItem.update).not.toHaveBeenCalled();
    });

    it('rejects resolving a line that is already linked to a product', async () => {
      const bid = adHocBid();
      (bid.lineItems[0] as { productId: string | null }).productId =
        'prod-existing';
      prisma.bid.findUnique.mockResolvedValue(bid);

      await expect(
        service.resolveLineItem('bid-1', 'li-0', { productId: 'prod-9' }, rep),
      ).rejects.toThrow(/already linked to a product/);
    });

    it('rejects resolving to an inactive product', async () => {
      prisma.bid.findUnique.mockResolvedValue(adHocBid());
      prisma.product.findUnique.mockResolvedValue({
        id: 'prod-9',
        isActive: false,
      });

      await expect(
        service.resolveLineItem('bid-1', 'li-0', { productId: 'prod-9' }, rep),
      ).rejects.toThrow(/inactive/);
      expect(prisma.bidLineItem.update).not.toHaveBeenCalled();
    });

    it('rejects when the line item does not belong to the bid', async () => {
      prisma.bid.findUnique.mockResolvedValue(adHocBid());

      await expect(
        service.resolveLineItem(
          'bid-1',
          'li-missing',
          { productId: 'prod-9' },
          rep,
        ),
      ).rejects.toThrow(/Line item not found/);
    });
  });

  describe('countAdHocLineItems — cross-bid awaiting-setup count', () => {
    it('counts unresolved lines and the distinct bids they belong to (open statuses only)', async () => {
      prisma.bidLineItem.findMany.mockResolvedValue([
        { bidId: 'bid-1' },
        { bidId: 'bid-1' },
        { bidId: 'bid-2' },
      ]);

      const result = await service.countAdHocLineItems(rep);

      expect(result).toEqual({ lineItemCount: 3, bidCount: 2 });
      const whereArg = prisma.bidLineItem.findMany.mock.calls[0][0].where;
      expect(whereArg.productId).toBeNull();
      expect(whereArg.bid.status.in).toEqual(
        expect.arrayContaining([
          BidStatus.DRAFT,
          BidStatus.PENDING_APPROVAL,
          BidStatus.APPROVED,
          BidStatus.SENT,
          BidStatus.ACCEPTED,
        ]),
      );
      // Dead-end statuses never convert, so they're excluded.
      expect(whereArg.bid.status.in).not.toContain(BidStatus.EXPIRED);
      expect(whereArg.bid.status.in).not.toContain(BidStatus.REJECTED);
      expect(whereArg.bid.status.in).not.toContain(BidStatus.LOST);
    });

    it('returns zeros for a non-Sales caller without querying', async () => {
      access.isSalesStaff.mockResolvedValue(false);
      const outsider: AuthenticatedUser = {
        id: 'x-1',
        email: 'x@x.com',
        role: Role.EMPLOYEE,
        verticalId: 'v-other',
      };

      const result = await service.countAdHocLineItems(outsider);

      expect(result).toEqual({ lineItemCount: 0, bidCount: 0 });
      expect(prisma.bidLineItem.findMany).not.toHaveBeenCalled();
    });
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

  describe('closeAsLost — record a reasoned commercial loss', () => {
    // The raw shape `findRawOrThrow` returns, plus the extra fields `toEntity`
    // reads off the row the transaction writes back.
    function rawBid(overrides: Record<string, unknown> = {}) {
      return {
        id: 'bid-1',
        bidNumber: 'BID-2026-0025',
        opportunityId: 'opp-1',
        customerId: 'cust-1',
        status: BidStatus.SENT,
        validUntil: new Date(),
        tenderReferenceNumber: null,
        quotationSubject: null,
        technicalSpecification: null,
        attachments: null,
        subtotal: new Prisma.Decimal('1598802'),
        discountPercent: new Prisma.Decimal('0'),
        discountAmount: new Prisma.Decimal('0'),
        taxType: null,
        taxRate: null,
        taxAmount: new Prisma.Decimal('0'),
        totalAmount: new Prisma.Decimal('1598802'),
        createdById: 'emp-1',
        approverId: null,
        approvedAt: null,
        approverComments: null,
        lostReason: null,
        closedAsLostById: null,
        closedAsLostAt: null,
        orders: [],
        lineItems: [],
        createdAt: new Date(),
        updatedAt: new Date(),
        ...overrides,
      };
    }

    /**
     * `closeAsLost` runs its write inside `$transaction(async (tx) => …)`, so the
     * bare `$transaction` mock has to become a callback runner handing back a
     * `tx` with the three delegates the closure touches.
     */
    let tx: any;
    beforeEach(() => {
      tx = {
        bid: { update: jest.fn(), count: jest.fn().mockResolvedValue(0) },
        opportunity: {
          findUnique: jest
            .fn()
            .mockResolvedValue({ id: 'opp-1', stage: 'PROPOSAL' }),
          update: jest.fn(),
        },
      };
      prisma.$transaction.mockImplementation((cb: any) => cb(tx));
      tx.bid.update.mockImplementation(async ({ data }: any) =>
        rawBid({
          ...data,
          closedAsLostBy: { firstName: 'Ada', lastName: 'L' },
        }),
      );
    });

    it.each([BidStatus.SENT, BidStatus.APPROVED, BidStatus.EXPIRED])(
      'closes a %s bid, stamping the reason, closer and timestamp',
      async (status) => {
        prisma.bid.findUnique.mockResolvedValue(rawBid({ status }));

        const result = await service.closeAsLost(
          'bid-1',
          { lostReason: '  Lost to competitor on price  ' },
          rep,
        );

        expect(result.status).toBe(BidStatus.LOST);
        expect(result.lostReason).toBe('Lost to competitor on price');
        expect(result.closedAsLostById).toBe('emp-1');
        expect(result.closedAsLostByName).toBe('Ada L');
        expect(result.closedAsLostAt).toBeInstanceOf(Date);
        // The reason is stored trimmed, not as typed.
        expect(tx.bid.update.mock.calls[0][0].data).toMatchObject({
          status: BidStatus.LOST,
          lostReason: 'Lost to competitor on price',
          closedAsLostById: 'emp-1',
        });
      },
    );

    it.each([
      BidStatus.DRAFT,
      BidStatus.PENDING_APPROVAL,
      BidStatus.ACCEPTED,
      BidStatus.REJECTED,
    ])('refuses to close a %s bid', async (status) => {
      prisma.bid.findUnique.mockResolvedValue(rawBid({ status }));

      await expect(
        service.closeAsLost('bid-1', { lostReason: 'nope' }, rep),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('tells the caller when the bid is already closed as lost', async () => {
      prisma.bid.findUnique.mockResolvedValue(
        rawBid({ status: BidStatus.LOST }),
      );

      await expect(
        service.closeAsLost('bid-1', { lostReason: 'again' }, rep),
      ).rejects.toThrow(/already closed as lost/);
    });

    it('refuses a bid that already has an order', async () => {
      prisma.bid.findUnique.mockResolvedValue(
        rawBid({ orders: [{ id: 'ord-1' }] }),
      );

      await expect(
        service.closeAsLost('bid-1', { lostReason: 'lost' }, rep),
      ).rejects.toThrow(/already been converted to an order/);
    });

    it('requires a non-blank reason', async () => {
      prisma.bid.findUnique.mockResolvedValue(rawBid());

      await expect(
        service.closeAsLost('bid-1', { lostReason: '   ' }, rep),
      ).rejects.toThrow(/lostReason is required/);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('enforces the owner/manager-chain write guard', async () => {
      prisma.bid.findUnique.mockResolvedValue(
        rawBid({ createdById: 'other-emp' }),
      );
      access.assertCanAccessOwned.mockRejectedValue(
        new Error('outside your team'),
      );

      await expect(
        service.closeAsLost('bid-1', { lostReason: 'lost' }, rep),
      ).rejects.toThrow('outside your team');
      expect(access.assertCanAccessOwned).toHaveBeenCalledWith(
        rep,
        'other-emp',
      );
    });

    it('closes the opportunity as CLOSED_LOST once no live bid remains', async () => {
      prisma.bid.findUnique.mockResolvedValue(rawBid());
      tx.bid.count.mockResolvedValue(0);

      await service.closeAsLost('bid-1', { lostReason: 'Budget pulled' }, rep);

      expect(tx.opportunity.update).toHaveBeenCalledWith({
        where: { id: 'opp-1' },
        data: {
          stage: 'CLOSED_LOST',
          lostReason: 'All bids closed — last was BID-2026-0025: Budget pulled',
        },
      });
      // Only live statuses count as survivors; dead ends must not block closure.
      const countWhere = tx.bid.count.mock.calls[0][0].where;
      expect(countWhere.opportunityId).toBe('opp-1');
      expect(countWhere.status.in).not.toContain(BidStatus.LOST);
      expect(countWhere.status.in).not.toContain(BidStatus.EXPIRED);
    });

    it('leaves the opportunity open while a sibling bid is still live', async () => {
      prisma.bid.findUnique.mockResolvedValue(rawBid());
      tx.bid.count.mockResolvedValue(1);

      await service.closeAsLost('bid-1', { lostReason: 'Lost' }, rep);

      expect(tx.opportunity.update).not.toHaveBeenCalled();
    });

    it.each(['CLOSED_WON', 'CLOSED_LOST'])(
      'never rewrites a %s opportunity',
      async (stage) => {
        prisma.bid.findUnique.mockResolvedValue(rawBid());
        tx.opportunity.findUnique.mockResolvedValue({ id: 'opp-1', stage });

        await service.closeAsLost('bid-1', { lostReason: 'Lost' }, rep);

        expect(tx.opportunity.update).not.toHaveBeenCalled();
        // Short-circuits before counting — a won deal is never re-evaluated.
        expect(tx.bid.count).not.toHaveBeenCalled();
      },
    );
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
