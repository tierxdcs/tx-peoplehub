import { Prisma } from '@prisma/client';
import { PrismaService } from '../../core/database/prisma.service';
import { SalesDashboardService } from './sales-dashboard.service';

const d = (n: string | number) => new Prisma.Decimal(n);
const utc = (y: number, m: number, day = 1) => new Date(Date.UTC(y, m - 1, day));
const NOW = utc(2026, 8, 25);

interface Fixture {
  bookedOrders?: unknown[];
  priorOrders?: unknown[];
  invoices?: unknown[];
  priorInvoices?: unknown[];
  openInvoices?: unknown[];
  allocations?: unknown[];
  receipts?: unknown[];
  leadCount?: number;
  opportunities?: unknown[];
  bids?: unknown[];
  activeCustomers?: number;
  previouslyOrdering?: unknown[];
  firstOrderAt?: Date | null;
  firstInvoiceAt?: Date | null;
}

/** Captured `where` clauses, so the sample/cancelled exclusions can be asserted. */
const orderWheres: Prisma.OrderWhereInput[] = [];

function buildService(fixture: Fixture) {
  orderWheres.length = 0;
  const prisma = {
    order: {
      findMany: jest.fn((args: any) => {
        orderWheres.push(args.where);
        if (args.distinct) return Promise.resolve(fixture.previouslyOrdering ?? []);
        if (args.select.lineItems) return Promise.resolve(fixture.bookedOrders ?? []);
        return Promise.resolve(fixture.priorOrders ?? []);
      }),
      findFirst: jest.fn(() =>
        Promise.resolve(
          fixture.firstOrderAt === undefined || fixture.firstOrderAt === null
            ? null
            : { createdAt: fixture.firstOrderAt },
        ),
      ),
    },
    salesInvoice: {
      findMany: jest.fn((args: any) => {
        if (args.where.outstandingAmount) return Promise.resolve(fixture.openInvoices ?? []);
        if (args.select.invoiceDate) return Promise.resolve(fixture.invoices ?? []);
        return Promise.resolve(fixture.priorInvoices ?? []);
      }),
      findFirst: jest.fn(() =>
        Promise.resolve(
          fixture.firstInvoiceAt === undefined || fixture.firstInvoiceAt === null
            ? null
            : { invoiceDate: fixture.firstInvoiceAt },
        ),
      ),
    },
    receiptAllocation: { findMany: jest.fn(() => Promise.resolve(fixture.allocations ?? [])) },
    customerReceipt: { findMany: jest.fn(() => Promise.resolve(fixture.receipts ?? [])) },
    lead: { count: jest.fn(() => Promise.resolve(fixture.leadCount ?? 0)) },
    opportunity: { findMany: jest.fn(() => Promise.resolve(fixture.opportunities ?? [])) },
    bid: { findMany: jest.fn(() => Promise.resolve(fixture.bids ?? [])) },
    customer: { count: jest.fn(() => Promise.resolve(fixture.activeCustomers ?? 0)) },
  } as unknown as PrismaService;
  return new SalesDashboardService(prisma);
}

/** An order line whose product has a complete released-BOM cost roll-up. */
const costedLine = (quantity: number, lineTotal: number, unitCost: number) => ({
  quantity: d(quantity),
  lineTotal: d(lineTotal),
  product: { item: { boms: [{ rolledUpCostSnapshot: d(unitCost), isCostComplete: true }] } },
});

const order = (over: Record<string, unknown> = {}) => ({
  id: 'o1',
  createdAt: utc(2026, 5, 10),
  totalAmount: d(1000),
  customerId: 'c1',
  customer: { name: 'Acme' },
  businessUnitId: 'bu1',
  businessUnit: { name: 'Rail', colorHex: '#111111' },
  bid: null,
  lineItems: [],
  ...over,
});

describe('SalesDashboardService', () => {
  describe('sample and cancelled exclusion', () => {
    it('asks the database only for live CUSTOMER orders, on every order query', async () => {
      await buildService({}).build(NOW);
      expect(orderWheres).not.toHaveLength(0);
      for (const where of orderWheres) {
        expect(where.orderType).toBe('CUSTOMER');
        expect(where.status).toEqual({ not: 'CANCELLED' });
      }
    });

    it('states the exclusion on the payload so the page can print it', async () => {
      const result = await buildService({}).build(NOW);
      expect(result.basis.join(' ')).toContain('INTERNAL');
    });
  });

  describe('revenue', () => {
    it('keeps booked and recognised as separate figures plus an explicit bridge', async () => {
      const result = await buildService({
        bookedOrders: [order({ totalAmount: d(1000) }), order({ id: 'o2', totalAmount: d(500) })],
        invoices: [{ totalAmount: d(600), invoiceDate: utc(2026, 6, 3) }],
      }).build(NOW);
      expect(result.revenue.booked.total).toBe('1500.00');
      expect(result.revenue.recognised.total).toBe('600.00');
      expect(result.revenue.bookedNotYetRecognised).toBe('900.00');
    });

    it('never reports a negative billed-ahead bridge', async () => {
      const result = await buildService({
        bookedOrders: [order({ totalAmount: d(100) })],
        invoices: [{ totalAmount: d(400), invoiceDate: utc(2026, 6, 3) }],
      }).build(NOW);
      expect(result.revenue.bookedNotYetRecognised).toBe('0.00');
    });

    it('buckets the trend by fiscal month, keeping empty months', async () => {
      const result = await buildService({
        bookedOrders: [
          order({ createdAt: utc(2026, 4, 5), totalAmount: d(100) }),
          order({ id: 'o2', createdAt: utc(2026, 6, 5), totalAmount: d(200) }),
        ],
      }).build(NOW);
      expect(result.revenue.booked.trend.map((p) => [p.label, p.value])).toEqual([
        ['Apr 26', '100.00'],
        ['May 26', '0.00'],
        ['Jun 26', '200.00'],
        ['Jul 26', '0.00'],
        ['Aug 26', '0.00'],
      ]);
    });
  });

  describe('YoY honesty', () => {
    it('degrades to insufficient-history with the data start date, not a percentage', async () => {
      const result = await buildService({
        bookedOrders: [order({ totalAmount: d(1000) })],
        priorOrders: [],
        firstOrderAt: utc(2026, 2, 9),
      }).build(NOW);
      expect(result.revenue.booked.yoy.status).toBe('INSUFFICIENT_HISTORY');
      expect(result.revenue.booked.yoy.changePercent).toBeNull();
      expect(result.revenue.booked.yoy.detail).toContain('Feb 2026');
    });

    it('says so plainly when there is no history at all', async () => {
      const result = await buildService({ firstOrderAt: null }).build(NOW);
      expect(result.revenue.booked.yoy.detail).toContain('no order history yet');
    });

    it('computes a real percentage once a prior-year base exists', async () => {
      const result = await buildService({
        bookedOrders: [order({ totalAmount: d(1500) })],
        priorOrders: [{ totalAmount: d(1000) }],
      }).build(NOW);
      expect(result.revenue.booked.yoy.status).toBe('AVAILABLE');
      expect(result.revenue.booked.yoy.changePercent).toBe('50.00');
      expect(result.revenue.booked.yoy.comparisonLabel).toBe('FY 2025-26');
    });
  });

  describe('margin from the released-BOM roll-up', () => {
    it('nets pre-tax line value against rolled-up cost x quantity', async () => {
      // 10 units, ₹1,000 of line value, ₹60/unit rolled-up cost -> 40% margin.
      const result = await buildService({
        bookedOrders: [order({ lineItems: [costedLine(10, 1000, 60)] })],
      }).build(NOW);
      expect(result.margin.averagePercent).toBe('40.00');
      expect(result.margin.ordersMeasured).toBe(1);
    });

    it('excludes an order whose BOM cost is incomplete rather than overstating margin', async () => {
      const result = await buildService({
        bookedOrders: [
          order({ lineItems: [costedLine(10, 1000, 60)] }),
          order({
            id: 'o2',
            lineItems: [
              costedLine(10, 1000, 60),
              {
                quantity: d(1),
                lineTotal: d(500),
                product: {
                  item: { boms: [{ rolledUpCostSnapshot: d(100), isCostComplete: false }] },
                },
              },
            ],
          }),
        ],
      }).build(NOW);
      expect(result.margin.averagePercent).toBe('40.00');
      expect(result.margin.ordersMeasured).toBe(1);
      expect(result.margin.ordersUncosted).toBe(1);
      expect(result.margin.coverageNote).toContain('1 of 2');
    });

    it('excludes a line whose product has no released BOM at all', async () => {
      const result = await buildService({
        bookedOrders: [
          order({ lineItems: [{ quantity: d(1), lineTotal: d(100), product: { item: { boms: [] } } }] }),
        ],
      }).build(NOW);
      expect(result.margin.averagePercent).toBeNull();
      expect(result.margin.status).toBe('INSUFFICIENT_HISTORY');
    });

    it('reports no-data rather than 0% when there are no won orders', async () => {
      const result = await buildService({}).build(NOW);
      expect(result.margin.averagePercent).toBeNull();
      expect(result.margin.status).toBe('NO_DATA');
    });
  });

  describe('funnel', () => {
    it('gives leads a count with an explicit no-value note', async () => {
      const result = await buildService({ leadCount: 7 }).build(NOW);
      const leads = result.funnel.find((s) => s.key === 'leads')!;
      expect(leads.count).toBe(7);
      expect(leads.value).toBeNull();
      expect(leads.valueNote).toContain('no value field');
    });

    it('counts only bids that reached the customer as sent, and ACCEPTED as won', async () => {
      const result = await buildService({
        bids: [
          { status: 'DRAFT', createdAt: utc(2026, 5, 1), totalAmount: d(100), discountPercent: d(0), approvedAt: null },
          { status: 'SENT', createdAt: utc(2026, 5, 1), totalAmount: d(200), discountPercent: d(0), approvedAt: null },
          { status: 'ACCEPTED', createdAt: utc(2026, 5, 1), totalAmount: d(300), discountPercent: d(0), approvedAt: null },
          { status: 'EXPIRED', createdAt: utc(2026, 5, 1), totalAmount: d(400), discountPercent: d(0), approvedAt: null },
        ],
      }).build(NOW);
      const sent = result.funnel.find((s) => s.key === 'bids_sent')!;
      const won = result.funnel.find((s) => s.key === 'bids_won')!;
      expect(sent.count).toBe(3);
      expect(sent.value).toBe('900.00');
      expect(won.count).toBe(1);
      expect(result.winRate.percent).toBe('33.33');
    });

    it('reports a null win rate rather than 0% with no bids submitted', async () => {
      expect((await buildService({}).build(NOW)).winRate.percent).toBeNull();
    });
  });

  describe('cash flow', () => {
    it('splits AR outstanding into total and past-due', async () => {
      const result = await buildService({
        openInvoices: [
          { outstandingAmount: d(1000), dueDate: utc(2026, 7, 1) },
          { outstandingAmount: d(500), dueDate: utc(2026, 12, 1) },
        ],
      }).build(NOW);
      expect(result.cash.arOutstanding).toBe('1500.00');
      expect(result.cash.arOverdue).toBe('1000.00');
    });

    it('weights DSO by amount and clamps an advance payment to zero days', async () => {
      const result = await buildService({
        allocations: [
          { amount: d(900), receipt: { receiptDate: utc(2026, 5, 11) }, invoice: { invoiceDate: utc(2026, 5, 1) } },
          { amount: d(100), receipt: { receiptDate: utc(2026, 4, 1) }, invoice: { invoiceDate: utc(2026, 5, 1) } },
        ],
      }).build(NOW);
      expect(result.cash.dsoDays).toBe(9);
    });

    it('has a null DSO with no posted payments', async () => {
      expect((await buildService({}).build(NOW)).cash.dsoDays).toBeNull();
    });
  });

  describe('customers', () => {
    it('splits new vs repeat by whether they ordered before this fiscal year', async () => {
      const result = await buildService({
        bookedOrders: [
          order({ customerId: 'c1', customer: { name: 'Acme' }, totalAmount: d(600) }),
          order({ id: 'o2', customerId: 'c2', customer: { name: 'Beta' }, totalAmount: d(400) }),
        ],
        previouslyOrdering: [{ customerId: 'c1' }],
      }).build(NOW);
      expect(result.customers.repeatCount).toBe(1);
      expect(result.customers.repeatValue).toBe('600.00');
      expect(result.customers.newCount).toBe(1);
      expect(result.customers.newValue).toBe('400.00');
    });

    it('aggregates a customer across orders and ranks the top five', async () => {
      const result = await buildService({
        bookedOrders: [
          order({ customerId: 'c1', customer: { name: 'Acme' }, totalAmount: d(300) }),
          order({ id: 'o2', customerId: 'c1', customer: { name: 'Acme' }, totalAmount: d(300) }),
          order({ id: 'o3', customerId: 'c2', customer: { name: 'Beta' }, totalAmount: d(400) }),
        ],
      }).build(NOW);
      expect(result.customers.concentration.topFive.map((c) => [c.name, c.value])).toEqual([
        ['Acme', '600.00'],
        ['Beta', '400.00'],
      ]);
      expect(result.customers.concentration.topFivePercent).toBe('100.00');
    });

    it('shows the tail when there are more than five customers', async () => {
      const result = await buildService({
        bookedOrders: [1, 2, 3, 4, 5, 6].map((n) =>
          order({ id: `o${n}`, customerId: `c${n}`, customer: { name: `C${n}` }, totalAmount: d(n * 100) }),
        ),
      }).build(NOW);
      // 2100 total; top five = 600+500+400+300+200 = 2000, tail = 100.
      expect(result.customers.concentration.topFiveValue).toBe('2000.00');
      expect(result.customers.concentration.otherValue).toBe('100.00');
    });
  });

  describe('business units', () => {
    it('splits booked revenue by BU and surfaces untagged orders as their own slice', async () => {
      const result = await buildService({
        bookedOrders: [
          order({ totalAmount: d(700) }),
          order({ id: 'o2', businessUnitId: null, businessUnit: null, totalAmount: d(300) }),
        ],
      }).build(NOW);
      expect(result.businessUnits.map((b) => [b.name, b.value, b.percentOfTotal])).toEqual([
        ['Rail', '700.00', '70.00'],
        ['Not tagged', '300.00', '30.00'],
      ]);
      expect(result.businessUnits[0].colorHex).toBe('#111111');
    });
  });

  describe('sales cycle and discount', () => {
    it('measures opportunity-to-order only for pipeline orders', async () => {
      const result = await buildService({
        bookedOrders: [
          order({ createdAt: utc(2026, 5, 31), bid: { opportunity: { createdAt: utc(2026, 5, 1) } } }),
          order({ id: 'o2' }),
        ],
      }).build(NOW);
      expect(result.salesCycle.averageDays).toBe(30);
      expect(result.salesCycle.ordersMeasured).toBe(1);
      expect(result.salesCycle.ordersUnlinked).toBe(1);
    });

    it('averages discount over submitted bids including zero-discount ones', async () => {
      const result = await buildService({
        bids: [
          { status: 'SENT', createdAt: utc(2026, 5, 1), totalAmount: d(100), discountPercent: d(20), approvedAt: utc(2026, 5, 2) },
          { status: 'SENT', createdAt: utc(2026, 5, 1), totalAmount: d(100), discountPercent: d(0), approvedAt: null },
          { status: 'DRAFT', createdAt: utc(2026, 5, 1), totalAmount: d(100), discountPercent: d(90), approvedAt: null },
        ],
      }).build(NOW);
      expect(result.discount.averagePercent).toBe('10.00');
      expect(result.discount.bidsMeasured).toBe(2);
      expect(result.discount.approvedDiscountCount).toBe(1);
      // A month with no submitted bids is null (nothing to average), not 0%.
      expect(result.discount.trend.find((t) => t.label === 'Jun 26')!.value).toBeNull();
    });
  });

  describe('period', () => {
    it('reports the Indian fiscal year and elapsed months', async () => {
      const result = await buildService({}).build(NOW);
      expect(result.period.label).toBe('FY 2026-27');
      expect(result.period.monthsElapsed).toBe(5);
      expect(result.period.asOf).toBe(NOW);
    });
  });
});
