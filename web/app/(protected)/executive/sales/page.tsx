'use client';

/**
 * Executive Dashboards → Sales.
 *
 * Every figure on this page comes from the backend's /executive/dashboards/sales
 * projection; nothing is derived or re-aggregated here beyond turning fixed-2
 * strings into numbers for the charts. Two rules the layout has to honour:
 *
 *  - Booked and Recognised revenue stay two separately labelled figures. They
 *    answer different questions (what Sales won vs what Finance billed) and the
 *    gap between them is itself a metric, shown as the "booked, not yet billed"
 *    bridge.
 *  - A `null` from the API means "the data can't answer this". It renders as an
 *    em dash plus the backend's own explanation, never as 0 or a blank.
 *
 * Cost and margin appear here by design: the CEO-granted
 * hasExecutiveDashboardAccess flag is what admits a viewer, regardless of their
 * vertical (see ExecutiveShell).
 */

import { useCallback, useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import {
  Callout,
  SCard,
  SCardTitle,
  SignalChip,
  SIGNAL_BTN_GHOST,
  SIGNAL_EYEBROW,
  SIGNAL_FAINT,
  SIGNAL_MUTED,
  ToneChip,
} from '../../../components/ui/signal';
import { cn } from '../../../lib/utils';
import { formatINR } from '../../../lib/sales';
import { useNumberFormat } from '../../../lib/number-format-context';
import {
  fetchSalesDashboard,
  type SalesDashboard,
  type ShareSlice,
  type TrendPoint,
  type YoyComparison,
} from '../../../lib/executive';
import { ExecutiveShell } from '../_components/executive-shell';
import {
  CHART_COLORS,
  Donut,
  FunnelBars,
  Gauge,
  KpiTile,
  LegendRow,
  SLICE_PALETTE,
  SplitBar,
  TrendChart,
} from '../_components/charts';

export default function SalesExecutiveDashboardPage() {
  const { style } = useNumberFormat();
  const [data, setData] = useState<SalesDashboard | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(() => {
    setLoading(true);
    fetchSalesDashboard()
      .then((res) => {
        setData(res);
        setError(null);
      })
      .catch((err: unknown) =>
        setError(
          err instanceof Error ? err.message : 'Failed to load dashboard',
        ),
      )
      .finally(() => setLoading(false));
  }, []);

  useEffect(load, [load]);

  const money = (value: string | null | undefined) =>
    value === null || value === undefined ? '—' : formatINR(value, style);
  const compact = (value: number) => compactMoney(value, style);
  const num = (value: string | null | undefined) =>
    value === null || value === undefined ? null : Number(value);

  return (
    <ExecutiveShell
      active="sales"
      fixedHeader
      title="Sales Dashboard"
      chip={data ? <SignalChip>{data.period.label}</SignalChip> : undefined}
      description={
        data
          ? `As of ${formatDate(data.period.asOf)} · ${data.period.monthsElapsed} ${
              data.period.monthsElapsed === 1 ? 'month' : 'months'
            } into the fiscal year · Booked and Recognised revenue are shown separately`
          : 'Company-wide sales performance, including cost and margin'
      }
      actions={
        <button
          type="button"
          onClick={load}
          disabled={loading}
          className={cn(SIGNAL_BTN_GHOST, 'gap-1.5')}
        >
          <RefreshCw className={cn('size-3.5', loading && 'animate-spin')} />
          Refresh
        </button>
      }
      toolbar={
        data ? (
          <nav
            className="flex gap-1 overflow-x-auto"
            aria-label="Sales dashboard sections"
          >
            {[
              [
                '#sales-revenue',
                `Revenue (${data.revenue.booked.orderCount} won orders)`,
              ],
              [
                '#sales-performance',
                `Performance (${data.winRate.bidsSubmitted} submitted bids)`,
              ],
              ['#sales-pipeline', 'Pipeline & margin'],
              [
                '#sales-cash-customers',
                `Cash & customers (${data.customers.activeCount} active)`,
              ],
              ['#sales-mix-pricing', 'Business mix & pricing'],
            ].map(([href, label]) => (
              <a
                key={href}
                href={href}
                className="whitespace-nowrap rounded-md px-2.5 py-1.5 text-[11.5px] font-medium text-black/55 hover:bg-black/[.06] hover:text-black/80 dark:text-white/55 dark:hover:bg-white/[.08] dark:hover:text-white/85"
              >
                {label}
              </a>
            ))}
          </nav>
        ) : undefined
      }
    >
      {error && <Callout variant="danger">{error}</Callout>}
      {!data ? (
        <p className={cn('text-[13px]', SIGNAL_MUTED)}>
          {loading ? 'Loading…' : 'No dashboard data available.'}
        </p>
      ) : (
        <>
          {/* ── Revenue: two distinct figures, one shared trend ─────────── */}
          <div
            id="sales-revenue"
            className="scroll-mt-[var(--exec-chrome-height)]"
          >
            <SCard className="p-[18px]">
              <SCardTitle
                title="Revenue"
                subtitle={`${data.period.label} to date`}
                right={
                  <span className={cn('text-[11px]', SIGNAL_FAINT)}>
                    Booked = orders won · Recognised = invoices issued
                  </span>
                }
              />
              <div className="mt-4 grid gap-5 lg:grid-cols-[minmax(0,300px)_minmax(0,1fr)]">
                <div className="space-y-4">
                  <RevenueFigure
                    label="Booked revenue (YTD)"
                    value={money(data.revenue.booked.total)}
                    countLabel={`${data.revenue.booked.orderCount} won ${
                      data.revenue.booked.orderCount === 1 ? 'order' : 'orders'
                    }`}
                    color={CHART_COLORS.blue}
                    yoy={data.revenue.booked.yoy}
                    formatMoney={money}
                  />
                  <RevenueFigure
                    label="Recognised revenue (YTD)"
                    value={money(data.revenue.recognised.total)}
                    countLabel={`${data.revenue.recognised.invoiceCount} issued ${
                      data.revenue.recognised.invoiceCount === 1
                        ? 'invoice'
                        : 'invoices'
                    }`}
                    color={CHART_COLORS.green}
                    yoy={data.revenue.recognised.yoy}
                    formatMoney={money}
                  />
                  <div className="rounded-lg bg-black/[.04] px-3 py-2.5 dark:bg-white/[.05]">
                    <div className={SIGNAL_EYEBROW}>Booked, not yet billed</div>
                    <div className="mt-1 text-[16px] font-extrabold tracking-[-.6px] tabular-nums">
                      {money(data.revenue.bookedNotYetRecognised)}
                    </div>
                    <p className={cn('mt-1 text-[11px]', SIGNAL_FAINT)}>
                      Won order value still ahead of the invoicing run rate.
                    </p>
                  </div>
                </div>
                <TrendChart
                  labels={trendLabels(data.revenue.booked.trend)}
                  height={200}
                  formatValue={compact}
                  series={[
                    {
                      label: 'Booked',
                      color: CHART_COLORS.blue,
                      values: trendValues(data.revenue.booked.trend),
                      fill: true,
                    },
                    {
                      label: 'Recognised',
                      color: CHART_COLORS.green,
                      values: trendValues(data.revenue.recognised.trend),
                    },
                  ]}
                  emptyMessage="No orders or invoices in this fiscal year yet"
                />
              </div>
            </SCard>
          </div>

          {/* ── Headline KPIs, each with its own trend ──────────────────── */}
          <div
            id="sales-performance"
            className="grid scroll-mt-[var(--exec-chrome-height)] grid-cols-2 gap-px overflow-hidden rounded-xl border border-black/10 bg-black/10 md:grid-cols-4 dark:border-white/[.08] dark:bg-white/[.08]"
          >
            <KpiTile
              label="Win rate"
              value={
                data.winRate.percent === null
                  ? '—'
                  : `${Number(data.winRate.percent).toFixed(1)}%`
              }
              hint={
                data.winRate.bidsSubmitted === 0
                  ? 'No bids submitted in this period'
                  : `${data.winRate.bidsWon} won of ${data.winRate.bidsSubmitted} submitted` +
                    // Only mention losses once some are explicitly recorded —
                    // otherwise it reads as "0 lost" on data that never had the
                    // status available.
                    (data.winRate.bidsLost > 0
                      ? ` · ${data.winRate.bidsLost} lost`
                      : '')
              }
            />
            <KpiTile
              label="Average deal size"
              value={
                data.dealSize.averageValue === null
                  ? '—'
                  : compact(Number(data.dealSize.averageValue))
              }
              hint={
                data.dealSize.orderCount === 0
                  ? 'No won orders in this period'
                  : `across ${data.dealSize.orderCount} won ${
                      data.dealSize.orderCount === 1 ? 'order' : 'orders'
                    }`
              }
              trend={trendValues(data.dealSize.trend)}
              color={CHART_COLORS.blue}
            />
            <KpiTile
              label="Sales cycle"
              value={
                data.salesCycle.averageDays === null
                  ? '—'
                  : `${data.salesCycle.averageDays} d`
              }
              hint={
                data.salesCycle.averageDays === null
                  ? 'No order traceable back to an opportunity yet'
                  : `opportunity → won order · ${data.salesCycle.ordersMeasured} measured${
                      data.salesCycle.ordersUnlinked > 0
                        ? `, ${data.salesCycle.ordersUnlinked} unlinked`
                        : ''
                    }`
              }
            />
            <KpiTile
              label="Avg discount granted"
              value={
                data.discount.averagePercent === null
                  ? '—'
                  : `${Number(data.discount.averagePercent).toFixed(1)}%`
              }
              hint={
                data.discount.bidsMeasured === 0
                  ? 'No submitted bids to measure'
                  : `${data.discount.bidsMeasured} submitted bids · ${data.discount.approvedDiscountCount} approved`
              }
              trend={trendValues(data.discount.trend)}
              color={CHART_COLORS.orange}
            />
          </div>

          <div
            id="sales-pipeline"
            className="grid scroll-mt-[var(--exec-chrome-height)] gap-4 lg:grid-cols-2"
          >
            {/* ── Funnel ───────────────────────────────────────────────── */}
            <SCard className="p-[18px]">
              <SCardTitle
                title="Pipeline funnel"
                subtitle="count and value at each stage"
              />
              <div className="mt-4">
                <FunnelBars
                  stages={data.funnel.map((stage, index) => ({
                    key: stage.key,
                    label: stage.label,
                    count: stage.count,
                    valueLabel: stage.value === null ? '—' : money(stage.value),
                    note: stage.valueNote,
                    color: FUNNEL_COLORS[index % FUNNEL_COLORS.length],
                  }))}
                />
              </div>
            </SCard>

            {/* ── Margin, straight off the BOM cost roll-up ─────────────── */}
            <SCard className="p-[18px]">
              <SCardTitle
                title="Average margin"
                subtitle="won orders, released-BOM cost roll-up"
                right={
                  <ToneChip
                    tone={
                      data.margin.status === 'AVAILABLE' ? 'success' : 'neutral'
                    }
                  >
                    {data.margin.status === 'AVAILABLE'
                      ? `${data.margin.ordersMeasured} costed`
                      : 'Not measurable'}
                  </ToneChip>
                }
              />
              <div className="mt-4 flex flex-wrap items-center gap-5">
                <Gauge
                  percent={num(data.margin.averagePercent)}
                  label="margin"
                  color={CHART_COLORS.green}
                />
                <div className="min-w-[180px] flex-1">
                  <div className={SIGNAL_EYEBROW}>Coverage</div>
                  <p className="mt-1.5 text-[12px] leading-relaxed text-black/60 dark:text-white/55">
                    {data.margin.coverageNote ??
                      (data.margin.status === 'AVAILABLE'
                        ? 'Every won order in this period has a complete released-BOM cost roll-up.'
                        : 'No won order in this period has a complete released-BOM cost roll-up yet.')}
                  </p>
                  <p className={cn('mt-2 text-[11px]', SIGNAL_FAINT)}>
                    Margin is computed on pre-tax line values against the latest
                    released BOM cost snapshot.
                  </p>
                </div>
              </div>
              <div className="mt-4">
                <TrendChart
                  labels={trendLabels(data.margin.trend)}
                  height={104}
                  formatValue={(value) => `${value.toFixed(1)}%`}
                  series={[
                    {
                      label: 'Monthly margin %',
                      color: CHART_COLORS.green,
                      values: trendValues(data.margin.trend),
                      fill: true,
                    },
                  ]}
                  emptyMessage="No month in this period has a costed won order"
                />
              </div>
            </SCard>
          </div>

          <div
            id="sales-cash-customers"
            className="grid scroll-mt-[var(--exec-chrome-height)] gap-4 lg:grid-cols-2"
          >
            {/* ── Cash ─────────────────────────────────────────────────── */}
            <SCard className="p-[18px]">
              <SCardTitle title="Cash flow" subtitle="accounts receivable" />
              <div className="mt-4 grid grid-cols-3 gap-3">
                <MiniStat
                  label="AR outstanding"
                  value={money(data.cash.arOutstanding)}
                  hint={`${data.cash.openInvoiceCount} open ${
                    data.cash.openInvoiceCount === 1 ? 'invoice' : 'invoices'
                  }`}
                />
                <MiniStat
                  label="Overdue"
                  value={money(data.cash.arOverdue)}
                  hint="past due date"
                  tone={
                    Number(data.cash.arOverdue) > 0 ? 'negative' : undefined
                  }
                />
                <MiniStat
                  label="DSO"
                  value={
                    data.cash.dsoDays === null ? '—' : `${data.cash.dsoDays} d`
                  }
                  hint={
                    data.cash.dsoPaymentsMeasured === 0
                      ? 'no payments received yet'
                      : `${data.cash.dsoPaymentsMeasured} payments measured`
                  }
                />
              </div>
              <div className="mt-4">
                <TrendChart
                  labels={trendLabels(data.cash.cashInTrend)}
                  height={128}
                  formatValue={compact}
                  series={[
                    {
                      label: `Cash in · ${money(data.cash.cashInTotal)} total`,
                      color: CHART_COLORS.teal,
                      values: trendValues(data.cash.cashInTrend),
                      fill: true,
                    },
                  ]}
                  emptyMessage="No receipts posted in this fiscal year yet"
                />
              </div>
            </SCard>

            {/* ── Customers ────────────────────────────────────────────── */}
            <SCard className="p-[18px]">
              <SCardTitle
                title="Customers"
                subtitle={`${data.customers.activeCount} active · ${data.customers.orderingCount} ordered this period`}
              />
              <div className="mt-4 flex flex-wrap items-center gap-5">
                <Donut
                  centerValue={
                    data.customers.concentration.topFivePercent === null
                      ? '—'
                      : `${Number(
                          data.customers.concentration.topFivePercent,
                        ).toFixed(0)}%`
                  }
                  centerLabel="top 5 share"
                  slices={concentrationSlices(data)}
                />
                <div className="min-w-[220px] flex-1 space-y-1.5">
                  <div className={SIGNAL_EYEBROW}>Concentration</div>
                  {data.customers.concentration.topFive.length === 0 ? (
                    <p className={cn('text-[12px]', SIGNAL_MUTED)}>
                      No customer has booked revenue in this period yet.
                    </p>
                  ) : (
                    <>
                      {data.customers.concentration.topFive.map(
                        (slice, index) => (
                          <LegendRow
                            key={slice.name}
                            color={SLICE_PALETTE[index % SLICE_PALETTE.length]}
                            label={slice.name}
                            value={compact(Number(slice.value))}
                            percentLabel={
                              slice.percentOfTotal === null
                                ? null
                                : `${Number(slice.percentOfTotal).toFixed(1)}%`
                            }
                          />
                        ),
                      )}
                      {Number(data.customers.concentration.otherValue) > 0 && (
                        <LegendRow
                          color={CHART_COLORS.slate}
                          label="All other customers"
                          value={compact(
                            Number(data.customers.concentration.otherValue),
                          )}
                          percentLabel={null}
                        />
                      )}
                    </>
                  )}
                </div>
              </div>
              <div className="mt-5">
                <div className={SIGNAL_EYEBROW}>
                  New vs repeat (this period)
                </div>
                <div className="mt-2">
                  <SplitBar
                    segments={[
                      {
                        label: `New · ${data.customers.newCount} · ${compact(Number(data.customers.newValue))}`,
                        value: Number(data.customers.newValue),
                        color: CHART_COLORS.purple,
                      },
                      {
                        label: `Repeat · ${data.customers.repeatCount} · ${compact(Number(data.customers.repeatValue))}`,
                        value: Number(data.customers.repeatValue),
                        color: CHART_COLORS.blue,
                      },
                    ]}
                  />
                </div>
                <p className={cn('mt-2 text-[11px]', SIGNAL_FAINT)}>
                  Split by booked value. &quot;New&quot; means the customer had
                  no order before {formatDate(data.period.startsOn)}.
                </p>
              </div>
            </SCard>
          </div>

          {/* ── Business units + discount trend ──────────────────────────── */}
          <div
            id="sales-mix-pricing"
            className="grid scroll-mt-[var(--exec-chrome-height)] gap-4 lg:grid-cols-2"
          >
            <SCard className="p-[18px]">
              <SCardTitle
                title="Booked revenue by business unit"
                subtitle="from BU tagging on orders"
              />
              <div className="mt-4 flex flex-wrap items-center gap-5">
                <Donut
                  centerValue={compact(Number(data.revenue.booked.total))}
                  centerLabel="booked YTD"
                  slices={data.businessUnits.map((slice, index) => ({
                    label: slice.name,
                    value: Number(slice.value),
                    color: sliceColor(slice, index),
                    percentLabel: slice.percentOfTotal,
                  }))}
                />
                <div className="min-w-[220px] flex-1 space-y-1.5">
                  {data.businessUnits.length === 0 ? (
                    <p className={cn('text-[12px]', SIGNAL_MUTED)}>
                      No booked revenue to attribute in this period yet.
                    </p>
                  ) : (
                    data.businessUnits.map((slice, index) => (
                      <LegendRow
                        key={slice.name}
                        color={sliceColor(slice, index)}
                        label={slice.name}
                        value={compact(Number(slice.value))}
                        percentLabel={
                          slice.percentOfTotal === null
                            ? null
                            : `${Number(slice.percentOfTotal).toFixed(1)}%`
                        }
                      />
                    ))
                  )}
                </div>
              </div>
            </SCard>

            <SCard className="p-[18px]">
              <SCardTitle
                title="Average discount granted"
                subtitle="early warning for margin erosion"
                right={
                  <span
                    className={cn('text-[11px] tabular-nums', SIGNAL_FAINT)}
                  >
                    {data.discount.averagePercent === null
                      ? 'not measurable'
                      : `${Number(data.discount.averagePercent).toFixed(2)}% period average`}
                  </span>
                }
              />
              <div className="mt-4">
                <TrendChart
                  labels={trendLabels(data.discount.trend)}
                  height={168}
                  formatValue={(value) => `${value.toFixed(1)}%`}
                  series={[
                    {
                      label: 'Discount % on submitted bids',
                      color: CHART_COLORS.orange,
                      values: trendValues(data.discount.trend),
                      fill: true,
                    },
                  ]}
                  emptyMessage="No submitted bids in this fiscal year yet"
                />
              </div>
            </SCard>
          </div>

          {/* ── The rules every figure above was computed under ─────────── */}
          <SCard className="p-[18px]">
            <details>
              <summary className="cursor-pointer list-none">
                <SCardTitle
                  title="Basis and exclusions"
                  subtitle="Metric definitions, scope and data limitations"
                  right={
                    <span className={cn('text-[11px]', SIGNAL_FAINT)}>
                      Expand methodology
                    </span>
                  }
                />
              </summary>
              <ul className="mt-2.5 space-y-1.5">
                {data.basis.map((line) => (
                  <li
                    key={line}
                    className={cn('text-[12px] leading-relaxed', SIGNAL_MUTED)}
                  >
                    {line}
                  </li>
                ))}
              </ul>
            </details>
          </SCard>
        </>
      )}
    </ExecutiveShell>
  );
}

/** Funnel stage colours, cool → warm as deals progress. */
const FUNNEL_COLORS = [
  CHART_COLORS.slate,
  CHART_COLORS.teal,
  CHART_COLORS.blue,
  CHART_COLORS.purple,
  CHART_COLORS.green,
];

/**
 * One headline revenue figure with its YoY line. When the comparison isn't
 * possible the backend's own explanation is printed instead of a percentage —
 * a short history is an expected state, not an error.
 */
function RevenueFigure({
  label,
  value,
  countLabel,
  color,
  yoy,
  formatMoney,
}: {
  label: string;
  value: string;
  countLabel: string;
  color: string;
  yoy: YoyComparison;
  formatMoney: (value: string | null) => string;
}) {
  const change = yoy.changePercent === null ? null : Number(yoy.changePercent);
  return (
    <div>
      <div className="flex items-center gap-2">
        <span
          className="h-[3px] w-3.5 rounded-full"
          style={{ background: color }}
        />
        <span className={SIGNAL_EYEBROW}>{label}</span>
      </div>
      <div className="mt-1.5 text-[27px] font-extrabold leading-none tracking-[-1.3px] tabular-nums">
        {value}
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <span className={cn('text-[11.5px]', SIGNAL_FAINT)}>{countLabel}</span>
        {change !== null && (
          <ToneChip tone={change >= 0 ? 'success' : 'danger'}>
            {change >= 0 ? '+' : ''}
            {change.toFixed(1)}% vs {yoy.comparisonLabel}
          </ToneChip>
        )}
      </div>
      {yoy.status === 'AVAILABLE' ? (
        <p className={cn('mt-1 text-[11px] tabular-nums', SIGNAL_FAINT)}>
          {yoy.comparisonLabel}: {formatMoney(yoy.priorValue)}
        </p>
      ) : (
        <p className={cn('mt-1 text-[11px]', SIGNAL_FAINT)}>{yoy.detail}</p>
      )}
    </div>
  );
}

/** Compact stat inside a card (smaller than the page-level KPI tiles). */
function MiniStat({
  label,
  value,
  hint,
  tone,
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: 'negative';
}) {
  return (
    <div>
      <div className={SIGNAL_EYEBROW}>{label}</div>
      <div
        className={cn(
          'mt-1.5 text-[17px] font-extrabold leading-none tracking-[-.7px] tabular-nums',
          tone === 'negative' && 'text-[#C13438] dark:text-[#FF8A8D]',
        )}
      >
        {value}
      </div>
      {hint && (
        <div className={cn('mt-1 text-[10.5px]', SIGNAL_FAINT)}>{hint}</div>
      )}
    </div>
  );
}

const trendLabels = (trend: TrendPoint[]) => trend.map((point) => point.label);
const trendValues = (trend: TrendPoint[]) =>
  trend.map((point) => (point.value === null ? null : Number(point.value)));

/** A BU's own colour when it has one, otherwise the shared palette. */
const sliceColor = (slice: ShareSlice, index: number) =>
  slice.colorHex ?? SLICE_PALETTE[index % SLICE_PALETTE.length];

/** Top-five slices plus the remainder, so the donut always totals the period. */
function concentrationSlices(data: SalesDashboard) {
  const slices = data.customers.concentration.topFive.map((slice, index) => ({
    label: slice.name,
    value: Number(slice.value),
    color: SLICE_PALETTE[index % SLICE_PALETTE.length],
    percentLabel: slice.percentOfTotal,
  }));
  const other = Number(data.customers.concentration.otherValue);
  if (other > 0) {
    slices.push({
      label: 'All other customers',
      value: other,
      color: CHART_COLORS.slate,
      percentLabel: null,
    });
  }
  return slices;
}

/**
 * Short money label for chart axes, legends and donut centres, where the full
 * grouped ₹ figure is too long to read. Headline numbers keep formatINR so they
 * remain exact and honour the reference-currency preference.
 */
function compactMoney(value: number, style: 'india' | 'international'): string {
  const sign = value < 0 ? '-' : '';
  const abs = Math.abs(value);
  const scale = (divisor: number, suffix: string) =>
    `${sign}₹${(abs / divisor).toFixed(abs / divisor >= 100 ? 0 : 2)} ${suffix}`;
  if (style === 'india') {
    if (abs >= 1e7) return scale(1e7, 'Cr');
    if (abs >= 1e5) return scale(1e5, 'L');
    if (abs >= 1e3) return scale(1e3, 'K');
  } else {
    if (abs >= 1e9) return scale(1e9, 'B');
    if (abs >= 1e6) return scale(1e6, 'M');
    if (abs >= 1e3) return scale(1e3, 'K');
  }
  return `${sign}₹${abs.toFixed(0)}`;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });
}
