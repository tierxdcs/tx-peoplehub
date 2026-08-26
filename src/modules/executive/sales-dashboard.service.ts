import { Injectable } from '@nestjs/common';
import {
  BidStatus,
  OrderStatus,
  OrderType,
  Prisma,
  ReceiptStatus,
  SalesInvoiceStatus,
} from '@prisma/client';
import { PrismaService } from '../../core/database/prisma.service';
import {
  averageDecimal,
  daysBetween,
  fiscalYearFor,
  money,
  monthKeyOf,
  monthsToDate,
  percent,
  samePeriodLastYear,
  shares,
  sumDecimals,
  weightedAverageDays,
  type MonthBucket,
} from './sales-dashboard.math';

/**
 * Whether a figure can be trusted, and why not when it can't. Every derived
 * number on this dashboard carries one of these instead of silently rendering a
 * zero: with order data starting in 2026 the honest answer to most historical
 * questions is "not enough history yet", and a CEO reading a 0% margin or a
 * -100% YoY would be misled by the opposite convention.
 */
export type DataMaturity = 'AVAILABLE' | 'INSUFFICIENT_HISTORY' | 'NO_DATA';

export interface YoyComparison {
  status: DataMaturity;
  /** Human label for the window being compared against, e.g. "Apr–Aug FY 2025-26". */
  comparisonLabel: string;
  /** Explains an unavailable comparison in the UI's own words. */
  detail: string | null;
  priorValue: string | null;
  changePercent: string | null;
}

export interface TrendPoint {
  key: string;
  label: string;
  /** Money as a fixed-2 string; null means "no measurable data this month". */
  value: string | null;
}

export interface FunnelStage {
  key: string;
  label: string;
  count: number;
  /** Null where the underlying record carries no monetary field at all. */
  value: string | null;
  /** Set only when `value` is null, explaining why. */
  valueNote: string | null;
}

export interface ShareSlice {
  name: string;
  value: string;
  percentOfTotal: string | null;
  colorHex: string | null;
}

/** Statuses at which a sales invoice has actually gone out to the customer. */
const ISSUED_INVOICE_STATUSES = [
  SalesInvoiceStatus.ISSUED,
  SalesInvoiceStatus.E_INVOICE_GENERATED,
  SalesInvoiceStatus.PARTIALLY_PAID,
  SalesInvoiceStatus.PAID,
  SalesInvoiceStatus.OVERDUE,
] as const;

/** A bid that actually reached the customer (the win-rate denominator). */
const SUBMITTED_BID_STATUSES = [
  BidStatus.SENT,
  BidStatus.ACCEPTED,
  BidStatus.EXPIRED,
] as const;

/**
 * Orders that count as booked revenue: a real customer commitment that is still
 * live. INTERNAL orders are samples / speculative Design-to-Dispatch builds —
 * the schema's own definition of OrderType says they are "excluded from
 * revenue/booked aggregation" — and CANCELLED orders were un-won. This is the
 * repo's only sample marker, and it is applied to every value figure below.
 */
const BOOKED_ORDER_WHERE = {
  orderType: OrderType.CUSTOMER,
  status: { not: OrderStatus.CANCELLED },
} as const;

/** Cheapest correct BOM cost source: the latest RELEASED revision's roll-up. */
const COST_INCLUDE = {
  select: {
    item: {
      select: {
        boms: {
          where: { status: 'RELEASED' as const },
          orderBy: { revisionNumber: 'desc' as const },
          take: 1,
          select: { rolledUpCostSnapshot: true, isCostComplete: true },
        },
      },
    },
  },
} as const;

const ZERO = new Prisma.Decimal(0);
const HUNDRED = new Prisma.Decimal(100);

/**
 * The Sales executive dashboard. Every figure is derived from records that
 * already exist — Orders, Bids, Opportunities, Leads, AR invoices/receipts,
 * Business Units and the released-BOM cost roll-up — with no new bookkeeping
 * asked of anyone and no estimation. Where the data genuinely cannot answer a
 * question (no prior-year history, a lead with no value field, an order whose
 * BOM costing is incomplete) the response says so explicitly rather than
 * emitting a zero that reads like a real measurement.
 *
 * Access is checked by ExecutiveAccessService at the controller, NOT here:
 * this service deliberately computes company-wide cost and margin regardless of
 * the caller's vertical, because exposing exactly that is the purpose of the
 * grant.
 */
@Injectable()
export class SalesDashboardService {
  constructor(private readonly prisma: PrismaService) {}

  async build(now = new Date()) {
    const period = fiscalYearFor(now);
    const prior = samePeriodLastYear(period, now);
    const months = monthsToDate(period, now);

    const [
      orders,
      priorOrders,
      invoices,
      priorInvoices,
      openInvoices,
      allocations,
      receipts,
      leadCount,
      opportunities,
      bids,
      activeCustomerCount,
      previouslyOrderingCustomers,
      firstOrder,
      firstInvoice,
    ] = await Promise.all([
      this.prisma.order.findMany({
        where: {
          ...BOOKED_ORDER_WHERE,
          createdAt: { gte: period.startsOn, lt: period.endsBefore },
        },
        select: {
          id: true,
          createdAt: true,
          totalAmount: true,
          customerId: true,
          customer: { select: { name: true } },
          businessUnitId: true,
          businessUnit: { select: { name: true, colorHex: true } },
          bid: { select: { opportunity: { select: { createdAt: true } } } },
          lineItems: {
            select: {
              quantity: true,
              lineTotal: true,
              product: COST_INCLUDE,
            },
          },
        },
      }),
      this.prisma.order.findMany({
        where: {
          ...BOOKED_ORDER_WHERE,
          createdAt: { gte: prior.startsOn, lt: prior.endsBefore },
        },
        select: { totalAmount: true },
      }),
      this.prisma.salesInvoice.findMany({
        where: {
          status: { in: [...ISSUED_INVOICE_STATUSES] },
          invoiceDate: { gte: period.startsOn, lt: period.endsBefore },
        },
        select: { totalAmount: true, invoiceDate: true },
      }),
      this.prisma.salesInvoice.findMany({
        where: {
          status: { in: [...ISSUED_INVOICE_STATUSES] },
          invoiceDate: { gte: prior.startsOn, lt: prior.endsBefore },
        },
        select: { totalAmount: true },
      }),
      // AR outstanding is a point-in-time balance, not a period figure: every
      // open invoice counts regardless of when it was raised.
      this.prisma.salesInvoice.findMany({
        where: {
          status: { in: [...ISSUED_INVOICE_STATUSES] },
          outstandingAmount: { gt: 0 },
        },
        select: { outstandingAmount: true, dueDate: true },
      }),
      this.prisma.receiptAllocation.findMany({
        where: {
          receipt: {
            status: ReceiptStatus.POSTED,
            receiptDate: { gte: period.startsOn, lt: period.endsBefore },
          },
        },
        select: {
          amount: true,
          receipt: { select: { receiptDate: true } },
          invoice: { select: { invoiceDate: true } },
        },
      }),
      this.prisma.customerReceipt.findMany({
        where: {
          status: ReceiptStatus.POSTED,
          receiptDate: { gte: period.startsOn, lt: period.endsBefore },
        },
        select: { amount: true, receiptDate: true },
      }),
      this.prisma.lead.count({
        where: { createdAt: { gte: period.startsOn, lt: period.endsBefore } },
      }),
      this.prisma.opportunity.findMany({
        where: { createdAt: { gte: period.startsOn, lt: period.endsBefore } },
        select: { estimatedValue: true },
      }),
      this.prisma.bid.findMany({
        where: { createdAt: { gte: period.startsOn, lt: period.endsBefore } },
        select: {
          status: true,
          createdAt: true,
          totalAmount: true,
          discountPercent: true,
          approvedAt: true,
        },
      }),
      this.prisma.customer.count({ where: { status: 'ACTIVE' } }),
      this.prisma.order.findMany({
        where: { ...BOOKED_ORDER_WHERE, createdAt: { lt: period.startsOn } },
        select: { customerId: true },
        distinct: ['customerId'],
      }),
      this.prisma.order.findFirst({
        where: BOOKED_ORDER_WHERE,
        orderBy: { createdAt: 'asc' },
        select: { createdAt: true },
      }),
      this.prisma.salesInvoice.findFirst({
        where: { status: { in: [...ISSUED_INVOICE_STATUSES] } },
        orderBy: { invoiceDate: 'asc' },
        select: { invoiceDate: true },
      }),
    ]);

    const bookedTotal = sumDecimals(orders.map((o) => o.totalAmount));
    const recognisedTotal = sumDecimals(invoices.map((i) => i.totalAmount));

    return {
      period: {
        label: period.label,
        startsOn: period.startsOn,
        endsBefore: period.endsBefore,
        asOf: now,
        monthsElapsed: months.length,
      },
      /**
       * Rendered verbatim on the page so the numbers are never mistaken for
       * "everything". The sample exclusion is the schema's INTERNAL order type —
       * see BOOKED_ORDER_WHERE.
       */
      basis: [
        'Sample and speculative builds (INTERNAL orders) are excluded from every count and value figure.',
        'Cancelled orders are excluded.',
        'Booked and Recognised revenue are both tax-inclusive totals; margin is computed on pre-tax line values.',
      ],
      revenue: this.revenue(
        orders,
        invoices,
        bookedTotal,
        recognisedTotal,
        priorOrders,
        priorInvoices,
        prior.label,
        months,
        firstOrder?.createdAt ?? null,
        firstInvoice?.invoiceDate ?? null,
      ),
      margin: this.margin(orders, months),
      funnel: this.funnel(leadCount, opportunities, bids, orders, bookedTotal),
      winRate: this.winRate(bids),
      dealSize: this.dealSize(orders, months),
      salesCycle: this.salesCycle(orders),
      cash: this.cash(openInvoices, allocations, receipts, months, now),
      customers: this.customers(
        orders,
        activeCustomerCount,
        previouslyOrderingCustomers,
        bookedTotal,
      ),
      businessUnits: this.businessUnits(orders, bookedTotal),
      discount: this.discount(bids, months),
    };
  }

  // ── Revenue: two distinct figures, never merged ──────────────────────────

  private revenue(
    orders: Array<{ createdAt: Date; totalAmount: Prisma.Decimal }>,
    invoices: Array<{ invoiceDate: Date; totalAmount: Prisma.Decimal }>,
    bookedTotal: Prisma.Decimal,
    recognisedTotal: Prisma.Decimal,
    priorOrders: Array<{ totalAmount: Prisma.Decimal }>,
    priorInvoices: Array<{ totalAmount: Prisma.Decimal }>,
    priorLabel: string,
    months: MonthBucket[],
    firstOrderAt: Date | null,
    firstInvoiceAt: Date | null,
  ) {
    return {
      /** What Sales has WON: the frozen bid total on each live customer order. */
      booked: {
        total: money(bookedTotal)!,
        orderCount: orders.length,
        trend: this.moneyTrend(
          months,
          orders.map((o) => ({ at: o.createdAt, value: o.totalAmount })),
        ),
        yoy: this.yoy(
          bookedTotal,
          sumDecimals(priorOrders.map((o) => o.totalAmount)),
          priorLabel,
          firstOrderAt,
          'order',
        ),
      },
      /** What has actually been BILLED: issued AR invoices. */
      recognised: {
        total: money(recognisedTotal)!,
        invoiceCount: invoices.length,
        trend: this.moneyTrend(
          months,
          invoices.map((i) => ({ at: i.invoiceDate, value: i.totalAmount })),
        ),
        yoy: this.yoy(
          recognisedTotal,
          sumDecimals(priorInvoices.map((i) => i.totalAmount)),
          priorLabel,
          firstInvoiceAt,
          'invoice',
        ),
      },
      /**
       * Booked not yet billed. Not a third revenue figure — an explicitly
       * labelled bridge between the two, so nobody has to subtract mentally
       * and reach for the wrong conclusion about which is "real" revenue.
       */
      bookedNotYetRecognised: money(
        Prisma.Decimal.max(bookedTotal.minus(recognisedTotal), ZERO),
      )!,
    };
  }

  /**
   * YoY against the SAME elapsed months of the prior fiscal year. Degrades to an
   * explicit "insufficient history" state rather than a percentage: with the
   * first order in 2026 the prior-year base is zero, and any percentage computed
   * off a zero base is meaningless (or infinite), not impressive.
   */
  private yoy(
    current: Prisma.Decimal,
    priorValue: Prisma.Decimal,
    comparisonLabel: string,
    firstRecordAt: Date | null,
    recordNoun: string,
  ): YoyComparison {
    if (priorValue.gt(0)) {
      return {
        status: 'AVAILABLE',
        comparisonLabel,
        detail: null,
        priorValue: money(priorValue),
        changePercent: percent(
          current.minus(priorValue).dividedBy(priorValue).times(HUNDRED),
        ),
      };
    }
    const since = firstRecordAt
      ? `${firstRecordAt.toLocaleString('en-IN', { month: 'short', timeZone: 'UTC' })} ${firstRecordAt.getUTCFullYear()}`
      : null;
    return {
      status: 'INSUFFICIENT_HISTORY',
      comparisonLabel,
      detail: since
        ? `Insufficient prior-year data — ${recordNoun} history begins ${since}`
        : `Insufficient prior-year data — no ${recordNoun} history yet`,
      priorValue: null,
      changePercent: null,
    };
  }

  // ── Margin: straight from the released-BOM cost roll-up ──────────────────

  /**
   * (order value − BOM cost) / order value, averaged across won orders. The cost
   * side is the existing released-BOM `rolledUpCostSnapshot` — no parallel
   * costing logic — and an order is measured ONLY when every line's BOM roll-up
   * is flagged `isCostComplete`. A partially-costed order would understate cost
   * and overstate margin, so it is reported as uncovered instead of guessed at.
   *
   * Revenue here is the sum of pre-tax line totals, not the tax-inclusive
   * `Order.totalAmount`, because BOM cost has no tax in it.
   */
  private margin(
    orders: Array<{
      createdAt: Date;
      lineItems: Array<{
        quantity: Prisma.Decimal;
        lineTotal: Prisma.Decimal;
        product: {
          item: {
            boms: Array<{
              rolledUpCostSnapshot: Prisma.Decimal | null;
              isCostComplete: boolean;
            }>;
          } | null;
        } | null;
      }>;
    }>,
    months: MonthBucket[],
  ) {
    const measured: Array<{ at: Date; marginPercent: Prisma.Decimal }> = [];
    let uncosted = 0;

    for (const order of orders) {
      if (order.lineItems.length === 0) continue;
      let revenue = ZERO;
      let cost = ZERO;
      let complete = true;
      for (const line of order.lineItems) {
        const bom = line.product?.item?.boms[0];
        if (!bom?.isCostComplete || bom.rolledUpCostSnapshot === null) {
          complete = false;
          break;
        }
        revenue = revenue.plus(line.lineTotal);
        cost = cost.plus(bom.rolledUpCostSnapshot.times(line.quantity));
      }
      if (!complete || revenue.lte(0)) {
        uncosted += 1;
        continue;
      }
      measured.push({
        at: order.createdAt,
        marginPercent: revenue.minus(cost).dividedBy(revenue).times(HUNDRED),
      });
    }

    const average = averageDecimal(measured.map((m) => m.marginPercent));
    return {
      averagePercent: percent(average),
      status: this.maturity(measured.length, orders.length),
      ordersMeasured: measured.length,
      ordersUncosted: uncosted,
      /** Stated on the page: a margin over 3 of 11 orders is not a company margin. */
      coverageNote:
        uncosted > 0
          ? `${uncosted} of ${orders.length} won orders have no complete released-BOM cost roll-up and are excluded from this average`
          : null,
      trend: months.map((bucket) => {
        const inMonth = measured
          .filter((m) => monthKeyOf(m.at) === bucket.key)
          .map((m) => m.marginPercent);
        return {
          key: bucket.key,
          label: bucket.label,
          value: percent(averageDecimal(inMonth)),
        };
      }),
    };
  }

  // ── Funnel ──────────────────────────────────────────────────────────────

  private funnel(
    leadCount: number,
    opportunities: Array<{ estimatedValue: Prisma.Decimal }>,
    bids: Array<{ status: BidStatus; totalAmount: Prisma.Decimal }>,
    orders: unknown[],
    bookedTotal: Prisma.Decimal,
  ): FunnelStage[] {
    const submitted = bids.filter((b) =>
      SUBMITTED_BID_STATUSES.includes(
        b.status as (typeof SUBMITTED_BID_STATUSES)[number],
      ),
    );
    const won = bids.filter((b) => b.status === BidStatus.ACCEPTED);
    return [
      {
        key: 'leads',
        label: 'Leads',
        count: leadCount,
        // A Lead records a `requirement` in prose and no amount at all, so there
        // is no honest value to put here. Shown as a count-only stage rather
        // than a fabricated ₹0 or an estimate.
        value: null,
        valueNote: 'Leads carry no value field — count only',
      },
      {
        key: 'opportunities',
        label: 'Opportunities',
        count: opportunities.length,
        value: money(sumDecimals(opportunities.map((o) => o.estimatedValue))),
        valueNote: null,
      },
      {
        key: 'bids_sent',
        label: 'Bids sent',
        count: submitted.length,
        value: money(sumDecimals(submitted.map((b) => b.totalAmount))),
        valueNote: null,
      },
      {
        key: 'bids_won',
        label: 'Bids won',
        count: won.length,
        value: money(sumDecimals(won.map((b) => b.totalAmount))),
        valueNote: null,
      },
      {
        key: 'orders',
        label: 'Orders booked',
        count: orders.length,
        value: money(bookedTotal),
        valueNote: null,
      },
    ];
  }

  private winRate(
    bids: Array<{ status: BidStatus; totalAmount: Prisma.Decimal }>,
  ) {
    const submitted = bids.filter((b) =>
      SUBMITTED_BID_STATUSES.includes(
        b.status as (typeof SUBMITTED_BID_STATUSES)[number],
      ),
    );
    const won = submitted.filter((b) => b.status === BidStatus.ACCEPTED);
    return {
      percent:
        submitted.length === 0
          ? null
          : percent(
              new Prisma.Decimal(won.length)
                .dividedBy(submitted.length)
                .times(HUNDRED),
            ),
      bidsSubmitted: submitted.length,
      bidsWon: won.length,
      submittedValue: money(sumDecimals(submitted.map((b) => b.totalAmount)))!,
      wonValue: money(sumDecimals(won.map((b) => b.totalAmount)))!,
      /** EXPIRED and still-open bids sit in the denominator honestly. */
      status: this.maturity(submitted.length, submitted.length),
    };
  }

  private dealSize(
    orders: Array<{ createdAt: Date; totalAmount: Prisma.Decimal }>,
    months: MonthBucket[],
  ) {
    return {
      averageValue: money(averageDecimal(orders.map((o) => o.totalAmount))),
      orderCount: orders.length,
      trend: months.map((bucket) => {
        const inMonth = orders
          .filter((o) => monthKeyOf(o.createdAt) === bucket.key)
          .map((o) => o.totalAmount);
        return {
          key: bucket.key,
          label: bucket.label,
          value: money(averageDecimal(inMonth)),
        };
      }),
    };
  }

  /**
   * Opportunity creation → won order, in days. Only orders that came through the
   * pipeline (order → bid → opportunity) can be measured; a directly-created
   * order has no opportunity to measure from and is reported as unmeasured.
   */
  private salesCycle(
    orders: Array<{
      createdAt: Date;
      bid: { opportunity: { createdAt: Date } } | null;
    }>,
  ) {
    const spans = orders
      .filter((o) => o.bid !== null)
      .map((o) => daysBetween(o.bid!.opportunity.createdAt, o.createdAt))
      .filter((days) => days >= 0);
    const average = averageDecimal(spans.map((d) => new Prisma.Decimal(d)));
    return {
      averageDays: average === null ? null : Math.round(average.toNumber()),
      ordersMeasured: spans.length,
      ordersUnlinked: orders.length - spans.length,
      status: this.maturity(spans.length, orders.length),
    };
  }

  // ── Cash flow ───────────────────────────────────────────────────────────

  private cash(
    openInvoices: Array<{
      outstandingAmount: Prisma.Decimal;
      dueDate: Date;
    }>,
    allocations: Array<{
      amount: Prisma.Decimal;
      receipt: { receiptDate: Date };
      invoice: { invoiceDate: Date };
    }>,
    receipts: Array<{ amount: Prisma.Decimal; receiptDate: Date }>,
    months: MonthBucket[],
    now: Date,
  ) {
    const outstanding = sumDecimals(openInvoices.map((i) => i.outstandingAmount));
    const overdue = sumDecimals(
      openInvoices
        .filter((i) => i.dueDate < now)
        .map((i) => i.outstandingAmount),
    );
    // DSO: amount-weighted days from invoice date to the receipt that settled
    // it, over payments actually POSTED this year. Negative spans (a payment
    // dated before its invoice, e.g. an advance) clamp to 0 rather than
    // flattering the average.
    const dso = weightedAverageDays(
      allocations.map((a) => ({
        amount: a.amount,
        days: Math.max(
          0,
          daysBetween(a.invoice.invoiceDate, a.receipt.receiptDate),
        ),
      })),
    );
    return {
      arOutstanding: money(outstanding)!,
      arOverdue: money(overdue)!,
      openInvoiceCount: openInvoices.length,
      dsoDays: dso,
      dsoPaymentsMeasured: allocations.length,
      cashInTotal: money(sumDecimals(receipts.map((r) => r.amount)))!,
      cashInTrend: this.moneyTrend(
        months,
        receipts.map((r) => ({ at: r.receiptDate, value: r.amount })),
      ),
    };
  }

  // ── Customers ───────────────────────────────────────────────────────────

  private customers(
    orders: Array<{
      customerId: string | null;
      customer: { name: string } | null;
      totalAmount: Prisma.Decimal;
    }>,
    activeCount: number,
    previouslyOrdering: Array<{ customerId: string | null }>,
    bookedTotal: Prisma.Decimal,
  ) {
    const before = new Set(
      previouslyOrdering
        .map((o) => o.customerId)
        .filter((id): id is string => id !== null),
    );
    const byCustomer = new Map<string, { name: string; value: Prisma.Decimal }>();
    let newValue = ZERO;
    let repeatValue = ZERO;
    const newIds = new Set<string>();
    const repeatIds = new Set<string>();

    for (const order of orders) {
      const id = order.customerId;
      if (id === null) continue;
      const existing = byCustomer.get(id);
      byCustomer.set(id, {
        name: order.customer?.name ?? 'Unnamed customer',
        value: (existing?.value ?? ZERO).plus(order.totalAmount),
      });
      if (before.has(id)) {
        repeatIds.add(id);
        repeatValue = repeatValue.plus(order.totalAmount);
      } else {
        newIds.add(id);
        newValue = newValue.plus(order.totalAmount);
      }
    }

    const topFive = shares(
      [...byCustomer.values()].map((c) => ({ name: c.name, value: c.value })),
      bookedTotal,
      5,
    );
    const topFiveValue = sumDecimals(topFive.map((c) => c.value));

    return {
      activeCount,
      orderingCount: byCustomer.size,
      /** "New" = no prior non-cancelled customer order before this fiscal year. */
      newCount: newIds.size,
      repeatCount: repeatIds.size,
      newValue: money(newValue)!,
      repeatValue: money(repeatValue)!,
      concentration: {
        totalValue: money(bookedTotal)!,
        topFiveValue: money(topFiveValue)!,
        topFivePercent: percent(
          bookedTotal.gt(0)
            ? topFiveValue.dividedBy(bookedTotal).times(HUNDRED)
            : null,
        ),
        otherValue: money(bookedTotal.minus(topFiveValue))!,
        topFive: topFive.map<ShareSlice>((c) => ({
          name: c.name,
          value: money(c.value)!,
          percentOfTotal: percent(c.percentOfTotal),
          colorHex: null,
        })),
      },
    };
  }

  /**
   * Booked revenue split by the Business Unit tagged on the order — the payoff
   * of the BU tagging already carried on Lead/Opportunity/Bid/Order. Orders with
   * no BU are surfaced as their own slice instead of being dropped, so the slices
   * always add up to booked revenue.
   */
  private businessUnits(
    orders: Array<{
      businessUnitId: string | null;
      businessUnit: { name: string; colorHex: string } | null;
      totalAmount: Prisma.Decimal;
    }>,
    bookedTotal: Prisma.Decimal,
  ): ShareSlice[] {
    const byUnit = new Map<
      string,
      { name: string; colorHex: string | null; value: Prisma.Decimal }
    >();
    for (const order of orders) {
      const key = order.businessUnitId ?? '__untagged__';
      const existing = byUnit.get(key);
      byUnit.set(key, {
        name: order.businessUnit?.name ?? 'Not tagged',
        colorHex: order.businessUnit?.colorHex ?? null,
        value: (existing?.value ?? ZERO).plus(order.totalAmount),
      });
    }
    return shares([...byUnit.values()], bookedTotal).map((slice) => ({
      name: slice.name,
      value: money(slice.value)!,
      percentOfTotal: percent(slice.percentOfTotal),
      colorHex: slice.colorHex,
    }));
  }

  /**
   * Average discount granted, over time — the margin-erosion early warning. Read
   * straight off `Bid.discountPercent`, the same field the >10% manager-approval
   * escalation gates on, and averaged over bids that actually went to a customer
   * (including zero-discount ones, which is what makes the average meaningful).
   */
  private discount(
    bids: Array<{
      status: BidStatus;
      createdAt: Date;
      discountPercent: Prisma.Decimal;
      approvedAt: Date | null;
    }>,
    months: MonthBucket[],
  ) {
    const submitted = bids.filter((b) =>
      SUBMITTED_BID_STATUSES.includes(
        b.status as (typeof SUBMITTED_BID_STATUSES)[number],
      ),
    );
    return {
      averagePercent: percent(
        averageDecimal(submitted.map((b) => b.discountPercent)),
      ),
      bidsMeasured: submitted.length,
      /** Bids that needed (and got) a manager's discount approval. */
      approvedDiscountCount: submitted.filter((b) => b.approvedAt !== null)
        .length,
      trend: months.map((bucket) => {
        const inMonth = submitted
          .filter((b) => monthKeyOf(b.createdAt) === bucket.key)
          .map((b) => b.discountPercent);
        return {
          key: bucket.key,
          label: bucket.label,
          value: percent(averageDecimal(inMonth)),
        };
      }),
    };
  }

  // ── Shared shaping ──────────────────────────────────────────────────────

  /**
   * Monthly totals across the elapsed fiscal year. A month with no records is a
   * real 0 (money did not move), unlike an average, where no records means null.
   */
  private moneyTrend(
    months: MonthBucket[],
    rows: Array<{ at: Date; value: Prisma.Decimal }>,
  ): TrendPoint[] {
    return months.map((bucket) => ({
      key: bucket.key,
      label: bucket.label,
      value: money(
        sumDecimals(
          rows.filter((r) => monthKeyOf(r.at) === bucket.key).map((r) => r.value),
        ),
      ),
    }));
  }

  private maturity(measured: number, total: number): DataMaturity {
    if (total === 0) return 'NO_DATA';
    if (measured === 0) return 'INSUFFICIENT_HISTORY';
    return 'AVAILABLE';
  }
}
