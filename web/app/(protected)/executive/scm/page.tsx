'use client';

/**
 * Executive Dashboards → SCM.
 *
 * Company-wide procurement and supply-base visibility for the SCM Head. Four
 * rules shape the layout:
 *
 *  - **Governance and compliance read first.** The queues that hold work up (RFQs
 *    waiting on PM approval, ad-hoc orders waiting on the CEO, overdue orders,
 *    silent vendors) and the decisions that need revisiting (non-lowest awards,
 *    classification overrides) sit above the steady-state counts.
 *  - **Nothing from Sales or Finance.** No revenue, margin or customer name
 *    appears — and none is on the wire either, because the backend strips the
 *    customer from the PLM rows, the resource-plan rows and the BOM intakes. The
 *    monetary figures here are purchase-order value, award premium and
 *    resource-plan cost variance: all purchasing figures.
 *  - **Named, not counted.** Every queue names its rows. §4 in particular is the
 *    full per-line vendor detail — the point of it is being able to chase one
 *    specific vendor who has gone quiet, which a count cannot support.
 *  - **The backend's own basis is shown, not paraphrased.** Where a metric rests
 *    on a substitution (the RFQ clock starting at creation, the award→PO match
 *    running through the provenance note, the audit queue being read off partner
 *    status), the explanation the service returns is rendered verbatim.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  AlertTriangle,
  ClipboardCheck,
  RefreshCw,
  ShieldAlert,
  TrendingDown,
  TrendingUp,
} from 'lucide-react';
import {
  Callout,
  SCard,
  SCardTitle,
  SignalChip,
  SIGNAL_BTN_GHOST,
  SIGNAL_EYEBROW,
  SIGNAL_FAINT,
  SIGNAL_MUTED,
  SIGNAL_ROW_DIVIDER,
  StatStrip,
  StatTile,
  ToneChip,
} from '../../../components/ui/signal';
import { cn } from '../../../lib/utils';
import { formatINR } from '../../../lib/sales';
import { useNumberFormat } from '../../../lib/number-format-context';
import {
  fetchScmDashboard,
  type ScmDashboard,
  type ScmTrendDirection,
  type ScmVendorLine,
} from '../../../lib/executive';
import { PLM_STAGE_LABEL, plmTrackerHref } from '../../../lib/plm';
import { URGENCY_PULSE_CLASS } from '../../../lib/urgency';
import { ExecutiveShell } from '../_components/executive-shell';
import {
  CHART_COLORS,
  Donut,
  LegendRow,
  SplitBar,
  TrendChart,
} from '../_components/charts';

const DANGER_TEXT = 'text-[#C13438] dark:text-[#FF8A8D]';
const WARNING_TEXT = 'text-[#C9761B] dark:text-[#E08A2C]';
const SUCCESS_TEXT = 'text-[#1E9E63] dark:text-[#3DD68C]';

/** The classification ladder, coldest (least trusted) to warmest. */
const CLASSIFICATION_COLORS: Record<string, string> = {
  APPROVED_PREFERRED: CHART_COLORS.green,
  APPROVED: CHART_COLORS.teal,
  CONDITIONALLY_APPROVED: CHART_COLORS.orange,
  NOT_APPROVED: CHART_COLORS.red,
};

/** Cadence verdicts, reusing the three health colours used across the app. */
const CADENCE_COLORS = {
  GREEN: '#3DD68C',
  AMBER: '#E08A2C',
  RED: '#E5484D',
} as const;

/** Above this share of purchase-order value, one partner is a real dependency. */
const CONCENTRATION_WARN_PERCENT = 40;

export default function ScmExecutiveDashboardPage() {
  const { style } = useNumberFormat();
  const [data, setData] = useState<ScmDashboard | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(() => {
    setLoading(true);
    fetchScmDashboard()
      .then((res) => {
        setData(res);
        setError(null);
      })
      .catch((err: unknown) =>
        setError(err instanceof Error ? err.message : 'Failed to load dashboard'),
      )
      .finally(() => setLoading(false));
  }, []);

  useEffect(load, [load]);

  const money = (value: string | null | undefined) =>
    value === null || value === undefined ? '—' : formatINR(value, style);

  const vendors = useMemo(() => data?.vendorProjects.vendors ?? [], [data]);
  const silentPartners = useMemo(
    () =>
      (data?.rfqHealth.participation.partners ?? []).filter(
        (partner) => partner.silent > 0,
      ),
    [data],
  );
  const topConcentration = Number(
    data?.supplyBase.concentration.topPartnerPercent ?? 0,
  );

  const onFire =
    (data?.rfqHealth.open.awaitingPmApproval ?? 0) +
    (data?.purchaseOrders.overdue.count ?? 0) +
    (data?.purchaseOrders.adHoc.pendingCount ?? 0) +
    (data?.vendorProjects.overdueUpdates ?? 0);

  return (
    <ExecutiveShell
      active="scm"
      title="SCM Dashboard"
      chip={
        data ? (
          <SignalChip>
            {data.supplyBase.registered.total} registered{' '}
            {data.supplyBase.registered.total === 1 ? 'partner' : 'partners'}
          </SignalChip>
        ) : undefined
      }
      description={
        data
          ? `Company-wide · as of ${formatDateTime(data.asOf)} · ${data.period.label} · procurement, supply base and vendor execution`
          : 'Company-wide procurement, vendor and supplier visibility'
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
    >
      {error && <Callout variant="danger">{error}</Callout>}
      {!data ? (
        <p className={cn('text-[13px]', SIGNAL_MUTED)}>
          {loading ? 'Loading…' : 'No dashboard data available.'}
        </p>
      ) : (
        <>
          {/* ══ What is holding the supply chain up ═══════════════════════ */}
          <StatStrip>
            <StatTile
              label="RFQs awaiting PM approval"
              value={data.rfqHealth.open.awaitingPmApproval}
              valueClass={
                data.rfqHealth.open.awaitingPmApproval > 0
                  ? WARNING_TEXT
                  : undefined
              }
              hint={
                data.rfqHealth.open.awaitingPmApproval === 0
                  ? `no RFQ is held at the approval gate · ${data.rfqHealth.open.total} open in total`
                  : `of ${data.rfqHealth.open.total} open · oldest waiting ${
                      data.rfqHealth.open.awaitingPmApprovalRfqs[0]
                        ?.waitingDays ?? 0
                    } day(s)`
              }
            />
            <StatTile
              label="Overdue purchase orders"
              value={data.purchaseOrders.overdue.count}
              valueClass={
                data.purchaseOrders.overdue.count > 0 ? DANGER_TEXT : undefined
              }
              hint={
                data.purchaseOrders.overdue.count === 0
                  ? 'every dated order is still inside its expected delivery date'
                  : `${money(data.purchaseOrders.overdue.value)} past expected delivery`
              }
            />
            <StatTile
              label="Ad-hoc POs awaiting CEO"
              value={data.purchaseOrders.adHoc.pendingCount}
              valueClass={
                data.purchaseOrders.adHoc.pendingCount > 0
                  ? WARNING_TEXT
                  : undefined
              }
              hint={`${data.purchaseOrders.adHoc.approvedThisPeriod} approved in ${data.period.label} · purchases outside the vetted base`}
            />
            <StatTile
              label="Vendor updates overdue"
              value={data.vendorProjects.overdueUpdates}
              valueClass={
                data.vendorProjects.overdueUpdates > 0 ? DANGER_TEXT : undefined
              }
              hint={`of ${data.vendorProjects.lineCount} vendor-executed line(s) across ${data.vendorProjects.vendorCount} vendor(s)`}
            />
          </StatStrip>

          {onFire === 0 && (
            <SCard className="p-[18px]">
              <p className={cn('text-[12.5px]', SIGNAL_MUTED)}>
                No RFQ is held at the approval gate, no purchase order is past its
                expected delivery date, nothing is waiting on CEO approval, and
                every vendor is inside its update cadence. The sections below carry
                the operating detail.
              </p>
            </SCard>
          )}

          {/* ══ §1 RFQ health ════════════════════════════════════════════ */}
          <SCard className="p-[18px]">
            <SCardTitle
              title="RFQ health"
              subtitle="the sourcing pipeline, how fast it moves and how vendors respond to it"
              right={
                <ToneChip
                  tone={
                    data.rfqHealth.open.awaitingPmApproval > 0
                      ? 'warning'
                      : 'success'
                  }
                >
                  {data.rfqHealth.open.total} open
                </ToneChip>
              }
            />
            <div className="mt-4 grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,340px)]">
              <div>
                <div className={SIGNAL_EYEBROW}>Where the open RFQs sit</div>
                <div className="mt-2.5">
                  <SplitBar
                    segments={[
                      {
                        label: 'Awaiting PM approval',
                        value: data.rfqHealth.open.awaitingPmApproval,
                        color: CHART_COLORS.orange,
                      },
                      {
                        label: 'Approved, not issued',
                        value: data.rfqHealth.open.approvedNotIssued,
                        color: CHART_COLORS.slate,
                      },
                      {
                        label: 'Issued, collecting quotes',
                        value: data.rfqHealth.open.issued,
                        color: CHART_COLORS.blue,
                      },
                      {
                        label: 'Closed, awaiting award',
                        value: data.rfqHealth.open.closedAwaitingAward,
                        color: CHART_COLORS.purple,
                      },
                    ]}
                  />
                </div>
                {data.rfqHealth.open.pmRejected > 0 && (
                  <p className={cn('mt-2.5 text-[11.5px]', WARNING_TEXT)}>
                    {data.rfqHealth.open.pmRejected} of these were rejected by the
                    Project Manager at least once and are back with SCM.
                  </p>
                )}

                {data.rfqHealth.open.awaitingPmApprovalRfqs.length > 0 && (
                  <div className="mt-4">
                    <div className={SIGNAL_EYEBROW}>
                      The approval queue · longest wait first
                    </div>
                    <div className="mt-1.5">
                      {data.rfqHealth.open.awaitingPmApprovalRfqs.map((rfq) => (
                        <div
                          key={rfq.id}
                          className={cn(
                            'flex items-baseline gap-2 border-b py-2 last:border-0',
                            SIGNAL_ROW_DIVIDER,
                          )}
                        >
                          <span className="text-[12px] font-semibold tabular-nums">
                            {rfq.rfqNumber}
                          </span>
                          <span className="min-w-0 flex-1 truncate text-[12px]">
                            {rfq.title}
                            {rfq.rejectedOnce && (
                              <span className={cn('ml-1.5 text-[11px]', WARNING_TEXT)}>
                                · rejected once
                              </span>
                            )}
                          </span>
                          <span className={cn('flex-none text-[11px]', SIGNAL_FAINT)}>
                            {rfq.lineCount} line(s) · {rfq.inviteeCount} invitee(s)
                          </span>
                          <span
                            className={cn(
                              'flex-none text-[12px] font-semibold tabular-nums',
                              rfq.waitingDays >= 7 ? DANGER_TEXT : WARNING_TEXT,
                              rfq.waitingDays >= 7 && URGENCY_PULSE_CLASS.stale,
                            )}
                          >
                            {rfq.waitingDays}d
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {/* Cycle times, each carrying the backend's own basis. */}
              <div className="space-y-3">
                <MetricBlock
                  label="Average RFQ response time"
                  value={days(data.rfqHealth.responseTime.averageDays)}
                  note={data.rfqHealth.responseTime.note}
                  detail={
                    data.rfqHealth.responseTime.quotesMeasured === 0
                      ? 'No quote has been submitted yet.'
                      : `across ${data.rfqHealth.responseTime.quotesMeasured} submitted quote(s) · of which our own approval gate took ${days(
                          data.rfqHealth.responseTime.pmApprovalLagDays,
                        )} on average`
                  }
                />
                <MetricBlock
                  label="Award cycle time"
                  value={days(data.rfqHealth.awardCycle.averageDays)}
                  note={data.rfqHealth.awardCycle.note}
                  detail={
                    data.rfqHealth.awardCycle.rfqsMeasured === 0
                      ? null
                      : `RFQ creation to award decision · ${data.rfqHealth.awardCycle.rfqsMeasured} award(s)`
                  }
                />
                <MetricBlock
                  label="Vendor participation rate"
                  value={pct(data.rfqHealth.participation.percent)}
                  note={data.rfqHealth.participation.note}
                  detail={`${data.rfqHealth.participation.submitted} of ${data.rfqHealth.participation.invited} invitee(s) quoted`}
                  valueClass={
                    data.rfqHealth.participation.percent === null
                      ? undefined
                      : Number(data.rfqHealth.participation.percent) < 50
                        ? WARNING_TEXT
                        : SUCCESS_TEXT
                  }
                />
              </div>
            </div>

            {/* Who is qualified but never answers — a qualification score cannot
                show this, so it is named rather than aggregated away. */}
            {silentPartners.length > 0 && (
              <div className="mt-5">
                <div className={SIGNAL_EYEBROW}>
                  Invited but silent · most unanswered invitations first
                </div>
                <div className="mt-1.5">
                  {silentPartners.map((partner) => (
                    <div
                      key={partner.key}
                      className={cn(
                        'flex items-baseline gap-2 border-b py-2 last:border-0',
                        SIGNAL_ROW_DIVIDER,
                      )}
                    >
                      <span className="min-w-0 flex-1 truncate text-[12.5px] font-semibold">
                        {partner.partnerName}
                      </span>
                      <span className={cn('flex-none text-[11px]', SIGNAL_FAINT)}>
                        {partner.partnerType === 'VENDOR' ? 'Vendor' : 'Supplier'}
                      </span>
                      <span className={cn('flex-none text-[11.5px]', SIGNAL_MUTED)}>
                        {partner.submitted}/{partner.invited} quoted
                        {partner.declined > 0 &&
                          ` · ${partner.declined} declined`}
                      </span>
                      <span
                        className={cn(
                          'flex-none text-[12px] font-semibold tabular-nums',
                          DANGER_TEXT,
                        )}
                      >
                        {partner.silent} no reply
                      </span>
                      <span className="flex-none text-[12px] font-semibold tabular-nums">
                        {pct(partner.participationPercent)}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </SCard>

          {/* ══ §1b Award governance ═════════════════════════════════════ */}
          <SCard
            className={cn(
              'p-[18px]',
              data.rfqHealth.nonLowestAwards.count > 0 &&
                'border-[#E08A2C]/40 bg-[#E08A2C]/[.04] dark:bg-[#E08A2C]/[.05]',
            )}
          >
            <SCardTitle
              title="Award governance"
              subtitle="awards that were not the lowest quote, with the justification recorded at the time"
              right={
                <ToneChip
                  tone={
                    data.rfqHealth.nonLowestAwards.count > 0
                      ? 'warning'
                      : 'success'
                  }
                >
                  {data.rfqHealth.nonLowestAwards.comparableAwards === 0
                    ? 'Nothing comparable yet'
                    : `${pct(data.rfqHealth.nonLowestAwards.percent)} of ${data.rfqHealth.nonLowestAwards.comparableAwards} award(s)`}
                </ToneChip>
              }
            />
            <p className={cn('mt-2 text-[11.5px]', SIGNAL_MUTED)}>
              {data.rfqHealth.nonLowestAwards.note}
            </p>
            {data.rfqHealth.nonLowestAwards.awards.length > 0 && (
              <div className="mt-3.5">
                {data.rfqHealth.nonLowestAwards.awards.map((award) => (
                  <div
                    key={award.rfqId}
                    className={cn(
                      'border-b py-2.5 last:border-0',
                      SIGNAL_ROW_DIVIDER,
                    )}
                  >
                    <div className="flex flex-wrap items-baseline gap-2">
                      <span className="text-[12px] font-semibold tabular-nums">
                        {award.rfqNumber}
                      </span>
                      <span className="min-w-0 flex-1 truncate text-[12.5px] font-semibold">
                        {award.awardedTo}
                      </span>
                      <span className={cn('text-[11px]', SIGNAL_FAINT)}>
                        {award.quotesCompared} quotes compared ·{' '}
                        {formatDate(award.awardedAt)}
                      </span>
                      <span
                        className={cn(
                          'text-[12.5px] font-bold tabular-nums',
                          WARNING_TEXT,
                        )}
                      >
                        +{money(award.premiumAmount)}
                        {award.premiumPercent && ` (${award.premiumPercent}%)`}
                      </span>
                    </div>
                    <p className={cn('mt-1 text-[11.5px]', SIGNAL_MUTED)}>
                      {award.title} —{' '}
                      {award.justification ? (
                        <span className="italic">
                          &ldquo;{award.justification}&rdquo;
                        </span>
                      ) : (
                        <span className={DANGER_TEXT}>
                          no justification recorded
                        </span>
                      )}
                    </p>
                  </div>
                ))}
              </div>
            )}

            {/* How often the post-close negotiation route is used, and with whom. */}
            <div className={cn('mt-4 border-t pt-3.5', SIGNAL_ROW_DIVIDER)}>
              <div className="flex flex-wrap items-baseline gap-2">
                <div className={SIGNAL_EYEBROW}>Quote revisions</div>
                <span className="text-[12.5px] font-semibold tabular-nums">
                  {data.rfqHealth.quoteRevisions.revisions} revised quote(s) ·{' '}
                  {data.rfqHealth.quoteRevisions.revisionRequests} reopened link(s)
                </span>
              </div>
              <p className={cn('mt-1 text-[11.5px]', SIGNAL_MUTED)}>
                {data.rfqHealth.quoteRevisions.note}
              </p>
              {data.rfqHealth.quoteRevisions.partners.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
                  {data.rfqHealth.quoteRevisions.partners.map((partner) => (
                    <span key={partner.key} className="text-[12px]">
                      <span className="font-semibold">{partner.partnerName}</span>
                      <span className={cn('ml-1', SIGNAL_MUTED)}>
                        {partner.revisions} revision(s)
                      </span>
                    </span>
                  ))}
                </div>
              )}
            </div>
          </SCard>

          {/* ══ §2 Purchase order health ═════════════════════════════════ */}
          <SCard className="p-[18px]">
            <SCardTitle
              title="Purchase order health"
              subtitle="what is on order, what is late, and what was bought outside the vetted base"
              right={
                <ToneChip
                  tone={
                    data.purchaseOrders.overdue.count > 0 ? 'danger' : 'success'
                  }
                >
                  {money(data.purchaseOrders.open.value)} open
                </ToneChip>
              }
            />
            <div className="mt-3.5 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <MetricBlock
                label="Open order value"
                value={money(data.purchaseOrders.open.value)}
                detail={`${data.purchaseOrders.open.count} order(s)`}
                note={data.purchaseOrders.open.note}
              />
              <MetricBlock
                label="Awaiting receipt"
                value={String(data.purchaseOrders.open.pendingReceipt)}
                detail={`${data.purchaseOrders.open.partiallyReceived} more partially received`}
                note={null}
              />
              <MetricBlock
                label="Past expected delivery"
                value={String(data.purchaseOrders.overdue.count)}
                valueClass={
                  data.purchaseOrders.overdue.count > 0 ? DANGER_TEXT : undefined
                }
                detail={`${money(data.purchaseOrders.overdue.value)} at risk${
                  data.purchaseOrders.overdue.withoutExpectedDate > 0
                    ? ` · ${data.purchaseOrders.overdue.withoutExpectedDate} order(s) carry no expected date and cannot be judged either way`
                    : ''
                }`}
                note={null}
              />
              <MetricBlock
                label="Award → PO issued"
                value={days(data.purchaseOrders.cycleTime.averageDays)}
                detail={
                  data.purchaseOrders.cycleTime.awardsInPeriod === 0
                    ? null
                    : `${data.purchaseOrders.cycleTime.awardsMatched} of ${data.purchaseOrders.cycleTime.awardsInPeriod} award(s) matched`
                }
                note={data.purchaseOrders.cycleTime.note}
              />
            </div>

            {data.purchaseOrders.overdue.orders.length > 0 && (
              <div className="mt-4">
                <div className={SIGNAL_EYEBROW}>
                  Overdue orders · longest overdue first
                </div>
                <div className="mt-1.5">
                  {data.purchaseOrders.overdue.orders.map((order) => (
                    <div
                      key={order.id}
                      className={cn(
                        'flex flex-wrap items-baseline gap-2 border-b py-2 last:border-0',
                        SIGNAL_ROW_DIVIDER,
                      )}
                    >
                      <AlertTriangle
                        className={cn('size-3.5 flex-none', DANGER_TEXT)}
                      />
                      <span className="text-[12px] font-semibold tabular-nums">
                        {order.poNumber}
                      </span>
                      <span className="min-w-0 flex-1 truncate text-[12.5px] font-semibold">
                        {order.partyName}
                      </span>
                      <span className={cn('flex-none text-[11px]', SIGNAL_FAINT)}>
                        due {formatDate(order.expectedDeliveryDate)}
                      </span>
                      <span className="flex-none text-[12px] font-semibold tabular-nums">
                        {money(order.value)}
                      </span>
                      <span
                        className={cn(
                          'flex-none text-[12px] font-bold tabular-nums',
                          DANGER_TEXT,
                          order.daysOverdue >= 14 && URGENCY_PULSE_CLASS.stale,
                        )}
                      >
                        {order.daysOverdue}d late
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* The compliance signal: buying outside the vetted base. */}
            <div
              className={cn(
                'mt-4 border-t pt-3.5',
                SIGNAL_ROW_DIVIDER,
              )}
            >
              <div className="flex flex-wrap items-baseline gap-2">
                <ShieldAlert
                  className={cn(
                    'size-3.5 flex-none',
                    data.purchaseOrders.adHoc.pendingCount > 0
                      ? WARNING_TEXT
                      : SIGNAL_MUTED,
                  )}
                />
                <div className={SIGNAL_EYEBROW}>
                  Ad-hoc orders awaiting CEO approval
                </div>
                <span
                  className={cn(
                    'text-[12.5px] font-semibold tabular-nums',
                    data.purchaseOrders.adHoc.pendingCount > 0
                      ? WARNING_TEXT
                      : undefined,
                  )}
                >
                  {data.purchaseOrders.adHoc.pendingCount} pending ·{' '}
                  {money(data.purchaseOrders.adHoc.pendingValue)}
                </span>
              </div>
              <p className={cn('mt-1 text-[11.5px]', SIGNAL_MUTED)}>
                {data.purchaseOrders.adHoc.note}
              </p>
              {data.purchaseOrders.adHoc.orders.length > 0 && (
                <div className="mt-2">
                  {data.purchaseOrders.adHoc.orders.map((order) => (
                    <div
                      key={order.id}
                      className={cn(
                        'flex flex-wrap items-baseline gap-2 border-b py-2 last:border-0',
                        SIGNAL_ROW_DIVIDER,
                      )}
                    >
                      <span className="text-[12px] font-semibold tabular-nums">
                        {order.poNumber}
                      </span>
                      <span className="min-w-0 flex-1 truncate text-[12.5px]">
                        {order.partyName}
                      </span>
                      <span className="flex-none text-[12px] font-semibold tabular-nums">
                        {money(order.value)}
                      </span>
                      <span
                        className={cn(
                          'flex-none text-[12px] tabular-nums',
                          order.waitingDays >= 7 ? WARNING_TEXT : SIGNAL_MUTED,
                        )}
                      >
                        waiting {order.waitingDays}d
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </SCard>

          {/* ══ §3 Vendor / supplier base ════════════════════════════════ */}
          <SCard className="p-[18px]">
            <SCardTitle
              title="Vendor and supplier base"
              subtitle="who is qualified, who is waiting on an audit, and who is running on an override"
              right={
                <ToneChip
                  tone={
                    data.supplyBase.overrides.count > 0 ? 'warning' : 'success'
                  }
                >
                  {data.supplyBase.registered.vendors} vendors ·{' '}
                  {data.supplyBase.registered.suppliers} suppliers
                </ToneChip>
              }
            />
            <p className={cn('mt-2 text-[11.5px]', SIGNAL_MUTED)}>
              {data.supplyBase.registered.note}
            </p>
            <div className="mt-4 grid gap-5 lg:grid-cols-[minmax(0,300px)_minmax(0,1fr)]">
              <div className="flex items-center gap-4">
                <Donut
                  slices={data.supplyBase.classification.map((row) => ({
                    label: row.label,
                    value: row.total,
                    color:
                      CLASSIFICATION_COLORS[row.status] ?? CHART_COLORS.slate,
                    percentLabel: null,
                  }))}
                  centerValue={String(data.supplyBase.registered.classified)}
                  centerLabel="classified"
                />
                <div className="min-w-0 flex-1 space-y-1.5">
                  {data.supplyBase.classification.map((row) => (
                    <LegendRow
                      key={row.status}
                      color={
                        CLASSIFICATION_COLORS[row.status] ?? CHART_COLORS.slate
                      }
                      label={row.label}
                      value={String(row.total)}
                      percentLabel={
                        row.total === 0
                          ? null
                          : `${row.vendors}V / ${row.suppliers}S`
                      }
                    />
                  ))}
                  {data.supplyBase.registered.unclassified > 0 && (
                    <p className={cn('pt-1 text-[11px]', SIGNAL_FAINT)}>
                      {data.supplyBase.registered.unclassified} not yet
                      classified — in the audit queue below.
                    </p>
                  )}
                </div>
              </div>

              <div className="space-y-3.5">
                <MetricBlock
                  label="Newly onboarded"
                  value={String(data.supplyBase.onboarded.thisPeriod)}
                  detail={`${data.supplyBase.onboarded.vendors} vendor(s), ${data.supplyBase.onboarded.suppliers} supplier(s) · ${pct(
                    data.supplyBase.onboarded.percentOfBase,
                  )} of the base`}
                  note={data.supplyBase.onboarded.note}
                />
                <div>
                  <div className="flex items-baseline gap-2">
                    <ClipboardCheck
                      className={cn('size-3.5 flex-none', SIGNAL_MUTED)}
                    />
                    <div className={SIGNAL_EYEBROW}>
                      Pending qualification audits
                    </div>
                    <span
                      className={cn(
                        'ml-auto text-[15px] font-extrabold tabular-nums',
                        data.supplyBase.auditQueue.total > 0
                          ? WARNING_TEXT
                          : undefined,
                      )}
                    >
                      {data.supplyBase.auditQueue.total}
                    </span>
                  </div>
                  <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1">
                    {data.supplyBase.auditQueue.stages.map((stage) => (
                      <span key={stage.status} className="text-[12px]">
                        <span className="font-semibold tabular-nums">
                          {stage.total}
                        </span>
                        <span className={cn('ml-1', SIGNAL_MUTED)}>
                          {stage.label}
                        </span>
                      </span>
                    ))}
                  </div>
                  <p className={cn('mt-1.5 text-[11.5px]', SIGNAL_MUTED)}>
                    {data.supplyBase.auditQueue.note}
                  </p>
                </div>
              </div>
            </div>

            {/* Overrides: visible and revisitable, never quietly permanent. */}
            <div className={cn('mt-4 border-t pt-3.5', SIGNAL_ROW_DIVIDER)}>
              <div className="flex flex-wrap items-baseline gap-2">
                <div className={SIGNAL_EYEBROW}>Active classification overrides</div>
                <span
                  className={cn(
                    'text-[12.5px] font-semibold tabular-nums',
                    data.supplyBase.overrides.count > 0
                      ? WARNING_TEXT
                      : undefined,
                  )}
                >
                  {data.supplyBase.overrides.count}
                </span>
              </div>
              <p className={cn('mt-1 text-[11.5px]', SIGNAL_MUTED)}>
                {data.supplyBase.overrides.note}
              </p>
              {data.supplyBase.overrides.partners.length > 0 && (
                <div className="mt-2">
                  {data.supplyBase.overrides.partners.map((partner) => (
                    <div
                      key={partner.id}
                      className={cn(
                        'flex flex-wrap items-baseline gap-2 border-b py-2 last:border-0',
                        SIGNAL_ROW_DIVIDER,
                      )}
                    >
                      <span className="min-w-0 flex-1 truncate text-[12.5px] font-semibold">
                        {partner.partnerName}
                      </span>
                      <span className={cn('flex-none text-[11px]', SIGNAL_FAINT)}>
                        {partner.partnerType === 'VENDOR' ? 'Vendor' : 'Supplier'}
                      </span>
                      <span
                        className={cn(
                          'flex-none text-[12px] font-semibold',
                          WARNING_TEXT,
                        )}
                      >
                        {partner.statusLabel} · overridden
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Concentration: the supply-side mirror of customer over-reliance. */}
            <div className={cn('mt-4 border-t pt-3.5', SIGNAL_ROW_DIVIDER)}>
              <div className="flex flex-wrap items-baseline gap-2">
                <div className={SIGNAL_EYEBROW}>
                  Concentration by purchase order value
                </div>
                <span className="text-[12.5px] font-semibold tabular-nums">
                  {money(data.supplyBase.concentration.totalPoValue)} total
                </span>
              </div>
              {data.supplyBase.concentration.topPartnerName && (
                <p
                  className={cn(
                    'mt-1.5 text-[12.5px]',
                    topConcentration >= CONCENTRATION_WARN_PERCENT
                      ? WARNING_TEXT
                      : SIGNAL_MUTED,
                  )}
                >
                  <span className="font-semibold">
                    {data.supplyBase.concentration.topPartnerName}
                  </span>{' '}
                  holds{' '}
                  {pct(data.supplyBase.concentration.topPartnerPercent)} of all
                  purchase order value
                  {topConcentration >= CONCENTRATION_WARN_PERCENT &&
                    ' — a single-partner dependency worth a second source'}
                  .
                </p>
              )}
              <p className={cn('mt-1 text-[11.5px]', SIGNAL_MUTED)}>
                {data.supplyBase.concentration.note}
              </p>
              {data.supplyBase.concentration.partners.length > 0 && (
                <div className="mt-2.5 space-y-2">
                  {data.supplyBase.concentration.partners.map(
                    (partner, index) => (
                      <div key={partner.name}>
                        <div className="flex items-baseline gap-2">
                          <span className="min-w-0 flex-1 truncate text-[12px] font-medium">
                            {index + 1}. {partner.name}
                          </span>
                          <span className="flex-none text-[12px] font-semibold tabular-nums">
                            {money(partner.value)}
                          </span>
                          <span
                            className={cn(
                              'w-[52px] flex-none text-right text-[12px] font-semibold tabular-nums',
                            )}
                          >
                            {pct(partner.percentOfTotal)}
                          </span>
                        </div>
                        <div className="mt-1 h-[9px] overflow-hidden rounded-[3px] bg-black/[.06] dark:bg-white/[.07]">
                          <div
                            className="h-full rounded-[3px]"
                            style={{
                              width: `${Math.max(
                                Number(partner.percentOfTotal ?? 0),
                                2,
                              )}%`,
                              background:
                                index === 0 &&
                                topConcentration >=
                                  CONCENTRATION_WARN_PERCENT
                                  ? CHART_COLORS.orange
                                  : CHART_COLORS.blue,
                            }}
                          />
                        </div>
                      </div>
                    ),
                  )}
                </div>
              )}
            </div>
          </SCard>

          {/* ══ §4 Vendor-operated project progress — the full detail ════ */}
          <SCard
            className={cn(
              'p-[18px]',
              data.vendorProjects.overdueUpdates > 0 &&
                'border-[#E5484D]/40 bg-[#E5484D]/[.04] dark:bg-[#E5484D]/[.05]',
            )}
          >
            <SCardTitle
              title="Vendor-executed lines"
              subtitle="every actively vendor-executed order line, grouped by vendor — quietest vendor first"
              right={
                <ToneChip
                  tone={
                    data.vendorProjects.overdueUpdates > 0 ? 'danger' : 'success'
                  }
                >
                  {data.vendorProjects.lineCount} line(s) ·{' '}
                  {data.vendorProjects.vendorCount} vendor(s)
                </ToneChip>
              }
            />
            <p className={cn('mt-2 text-[11.5px]', SIGNAL_MUTED)}>
              {data.vendorProjects.note}
              {data.vendorProjects.unlinkedVendorCount > 0 &&
                ` ${data.vendorProjects.unlinkedVendorCount} of these vendor(s) have no Vendor Master record, so their qualification and audit history cannot be checked.`}
            </p>
            {vendors.length > 0 && (
              <div className="mt-4 space-y-4">
                {vendors.map((vendor) => (
                  <div key={vendor.key}>
                    <div className="flex flex-wrap items-baseline gap-2">
                      <span className="text-[13px] font-bold">
                        {vendor.vendorName}
                      </span>
                      {!vendor.vendorId && (
                        <span className={cn('text-[11px]', SIGNAL_FAINT)}>
                          no Vendor Master link
                        </span>
                      )}
                      <span className={cn('text-[11.5px]', SIGNAL_MUTED)}>
                        {vendor.activeLines} line(s)
                      </span>
                      {vendor.overdueUpdates > 0 && (
                        <span
                          className={cn(
                            'text-[11.5px] font-semibold',
                            DANGER_TEXT,
                          )}
                        >
                          {vendor.overdueUpdates} update(s) overdue
                        </span>
                      )}
                      {vendor.dueSoonUpdates > 0 && (
                        <span
                          className={cn(
                            'text-[11.5px] font-semibold',
                            WARNING_TEXT,
                          )}
                        >
                          {vendor.dueSoonUpdates} due soon
                        </span>
                      )}
                      {vendor.blockedLines > 0 && (
                        <span
                          className={cn(
                            'text-[11.5px] font-semibold',
                            DANGER_TEXT,
                          )}
                        >
                          {vendor.blockedLines} blocked
                        </span>
                      )}
                    </div>
                    <div className="mt-1.5">
                      {vendor.lines.map((vendorLine) => (
                        <VendorLineRow
                          key={vendorLine.trackerId}
                          line={vendorLine}
                        />
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </SCard>

          {/* ══ §5 Sourcing backlog ══════════════════════════════════════ */}
          <SCard className="p-[18px]">
            <SCardTitle
              title="Sourcing backlog"
              subtitle="products and BOMs already made RFQ-ready that nobody has actioned"
              right={
                <ToneChip
                  tone={data.sourcingBacklog.total > 0 ? 'warning' : 'success'}
                >
                  {data.sourcingBacklog.total} waiting
                </ToneChip>
              }
            />
            <div className="mt-3.5 grid gap-5 lg:grid-cols-2">
              <div>
                <div className={SIGNAL_EYEBROW}>
                  BOM intakes with no RFQ raised
                </div>
                <p className={cn('mt-1 text-[11.5px]', SIGNAL_MUTED)}>
                  {data.sourcingBacklog.intakes.note}
                </p>
                <div className="mt-1.5">
                  {data.sourcingBacklog.intakes.rows.map((row) => (
                    <div
                      key={row.id}
                      className={cn(
                        'flex flex-wrap items-baseline gap-2 border-b py-2 last:border-0',
                        SIGNAL_ROW_DIVIDER,
                      )}
                    >
                      <span className="min-w-0 flex-1 truncate text-[12.5px] font-semibold">
                        {row.productName}
                      </span>
                      <span className={cn('flex-none text-[11px]', SIGNAL_FAINT)}>
                        {row.businessUnit} · {row.lineCount} line(s)
                        {!row.hasBom && ' · no BOM'}
                      </span>
                      <span
                        className={cn(
                          'flex-none text-[12px] tabular-nums',
                          row.idleDays >= 14 ? WARNING_TEXT : SIGNAL_MUTED,
                        )}
                      >
                        idle {row.idleDays}d
                      </span>
                    </div>
                  ))}
                </div>
              </div>
              <div>
                <div className={SIGNAL_EYEBROW}>Drafted RFQs never issued</div>
                <p className={cn('mt-1 text-[11.5px]', SIGNAL_MUTED)}>
                  {data.sourcingBacklog.draftRfqs.note}
                </p>
                <div className="mt-1.5">
                  {data.sourcingBacklog.draftRfqs.rows.map((row) => (
                    <div
                      key={row.id}
                      className={cn(
                        'flex flex-wrap items-baseline gap-2 border-b py-2 last:border-0',
                        SIGNAL_ROW_DIVIDER,
                      )}
                    >
                      <span className="text-[12px] font-semibold tabular-nums">
                        {row.rfqNumber}
                      </span>
                      <span className="min-w-0 flex-1 truncate text-[12.5px]">
                        {row.title}
                      </span>
                      <span className={cn('flex-none text-[11px]', SIGNAL_FAINT)}>
                        {row.awaitingPmApproval
                          ? 'awaiting PM approval'
                          : 'approved, not issued'}
                      </span>
                      <span
                        className={cn(
                          'flex-none text-[12px] tabular-nums',
                          row.idleDays >= 14 ? WARNING_TEXT : SIGNAL_MUTED,
                        )}
                      >
                        idle {row.idleDays}d
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </SCard>

          {/* ══ §6 Cost performance ══════════════════════════════════════ */}
          <SCard className="p-[18px]">
            <SCardTitle
              title="Cost performance"
              subtitle="negotiated cost against the benchmark snapshotted with each resource plan"
              right={
                data.costPerformance.status === 'RESTRICTED' ? (
                  <ToneChip tone="warning">Restricted</ToneChip>
                ) : (
                  <ToneChip
                    tone={
                      Number(data.costPerformance.varianceAmount ?? 0) > 0
                        ? 'danger'
                        : 'success'
                    }
                  >
                    {data.costPerformance.varianceAmount === null
                      ? 'Not measurable'
                      : `${
                          Number(data.costPerformance.varianceAmount) > 0
                            ? '+'
                            : ''
                        }${money(data.costPerformance.varianceAmount)}`}
                  </ToneChip>
                )
              }
            />
            {data.costPerformance.status === 'RESTRICTED' ? (
              <Callout variant="warning">{data.costPerformance.note}</Callout>
            ) : (
              <>
                <div className="mt-3.5 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                  <MetricBlock
                    label="Benchmark cost"
                    value={money(data.costPerformance.totalBenchmarkCost)}
                    detail={`${data.costPerformance.projectsWithPlan} project(s) with a plan`}
                    note={null}
                  />
                  <MetricBlock
                    label="Negotiated cost"
                    value={money(data.costPerformance.totalNegotiatedCost)}
                    detail={`${data.costPerformance.projectsCostComplete} of ${data.costPerformance.projectsWithPlan} fully priced`}
                    note={null}
                  />
                  <MetricBlock
                    label="Variance"
                    value={money(data.costPerformance.varianceAmount)}
                    valueClass={
                      data.costPerformance.varianceAmount === null
                        ? undefined
                        : Number(data.costPerformance.varianceAmount) > 0
                          ? DANGER_TEXT
                          : SUCCESS_TEXT
                    }
                    detail={
                      data.costPerformance.variancePercent === null
                        ? null
                        : `${data.costPerformance.variancePercent}% against benchmark`
                    }
                    note={null}
                  />
                  <MetricBlock
                    label="Projects over benchmark"
                    value={String(data.costPerformance.projectsOverBenchmark)}
                    valueClass={
                      data.costPerformance.projectsOverBenchmark > 0
                        ? DANGER_TEXT
                        : undefined
                    }
                    detail="negotiating above the snapshotted cost"
                    note={null}
                  />
                </div>
                <p className={cn('mt-3 text-[11.5px]', SIGNAL_MUTED)}>
                  {data.costPerformance.note}
                </p>
                {data.costPerformance.projects.length > 0 && (
                  <div className="mt-3">
                    <div className={SIGNAL_EYEBROW}>
                      By project · worst overrun first
                    </div>
                    <div className="mt-1.5">
                      {data.costPerformance.projects.map((project) => (
                        <div
                          key={project.planId}
                          className={cn(
                            'flex flex-wrap items-baseline gap-2 border-b py-2 last:border-0',
                            SIGNAL_ROW_DIVIDER,
                          )}
                        >
                          <span className="min-w-0 flex-1 truncate text-[12.5px] font-semibold">
                            {project.projectName}
                          </span>
                          <span
                            className={cn('flex-none text-[11px]', SIGNAL_FAINT)}
                          >
                            {project.orderNumber} ·{' '}
                            {project.negotiatedLineCount}/{project.lineCount}{' '}
                            priced
                            {!project.isCostComplete && ' · incomplete'}
                          </span>
                          <span className="flex-none text-[12px] tabular-nums">
                            {money(project.totalNegotiatedCost)}
                          </span>
                          <span
                            className={cn(
                              'w-[110px] flex-none text-right text-[12px] font-semibold tabular-nums',
                              project.varianceAmount === null
                                ? undefined
                                : Number(project.varianceAmount) > 0
                                  ? DANGER_TEXT
                                  : SUCCESS_TEXT,
                            )}
                          >
                            {project.varianceAmount === null
                              ? '—'
                              : `${
                                  Number(project.varianceAmount) > 0 ? '+' : ''
                                }${money(project.varianceAmount)}`}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </>
            )}
          </SCard>

          {/* ══ §7 Quality of supply ═════════════════════════════════════ */}
          <SCard className="p-[18px]">
            <SCardTitle
              title="Quality of supply"
              subtitle="rejections on received goods, attributed to the partner who shipped them"
              right={
                <ToneChip
                  tone={
                    data.qualityOfSupply.ncrs.open > 0 ? 'warning' : 'success'
                  }
                >
                  {data.qualityOfSupply.ncrs.raisedThisPeriod} NCR(s) in{' '}
                  {data.qualityOfSupply.periodLabel}
                </ToneChip>
              }
            />
            <p className={cn('mt-2 text-[11.5px]', SIGNAL_MUTED)}>
              {data.qualityOfSupply.ncrs.note}
            </p>
            <div className="mt-4 grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,320px)]">
              <div>
                <div className="flex items-baseline gap-2">
                  <div className={SIGNAL_EYEBROW}>
                    Non-conformances raised per month
                  </div>
                  <DirectionChip
                    direction={data.qualityOfSupply.ncrs.direction}
                    risingIsBad
                  />
                </div>
                <div className="mt-2">
                  <TrendChart
                    labels={data.qualityOfSupply.ncrs.trend.map(
                      (point) => point.label,
                    )}
                    series={[
                      {
                        label: 'NCRs raised',
                        color: CHART_COLORS.red,
                        values: data.qualityOfSupply.ncrs.trend.map(
                          (point) => point.value,
                        ),
                        fill: true,
                      },
                    ]}
                    formatValue={(value) => String(value)}
                    emptyMessage={`No non-conformance was raised on received goods in ${data.qualityOfSupply.periodLabel}.`}
                  />
                </div>
                <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
                  <span className="text-[12px]">
                    <span className={cn('font-semibold tabular-nums', data.qualityOfSupply.ncrs.open > 0 ? WARNING_TEXT : undefined)}>
                      {data.qualityOfSupply.ncrs.open}
                    </span>
                    <span className={cn('ml-1', SIGNAL_MUTED)}>open</span>
                  </span>
                  {data.qualityOfSupply.ncrs.dispositions
                    .filter((row) => row.count > 0)
                    .map((row) => (
                      <span key={row.disposition} className="text-[12px]">
                        <span className="font-semibold tabular-nums">
                          {row.count}
                        </span>
                        <span className={cn('ml-1', SIGNAL_MUTED)}>
                          {row.label}
                        </span>
                      </span>
                    ))}
                  {data.qualityOfSupply.ncrs.undispositioned > 0 && (
                    <span className="text-[12px]">
                      <span className="font-semibold tabular-nums">
                        {data.qualityOfSupply.ncrs.undispositioned}
                      </span>
                      <span className={cn('ml-1', SIGNAL_MUTED)}>
                        awaiting a disposition decision
                      </span>
                    </span>
                  )}
                </div>
              </div>

              <div>
                <div className={SIGNAL_EYEBROW}>
                  By partner · most rejections first
                </div>
                {data.qualityOfSupply.partners.length === 0 ? (
                  <p className={cn('mt-2 text-[12px]', SIGNAL_FAINT)}>
                    No partner has caused a rejection in{' '}
                    {data.qualityOfSupply.periodLabel}.
                  </p>
                ) : (
                  <div className="mt-1.5">
                    {data.qualityOfSupply.partners.map((partner) => (
                      <div
                        key={partner.key}
                        className={cn(
                          'flex items-baseline gap-2 border-b py-2 last:border-0',
                          SIGNAL_ROW_DIVIDER,
                        )}
                      >
                        <span className="min-w-0 flex-1 truncate text-[12.5px] font-semibold">
                          {partner.partnerName}
                        </span>
                        <span className={cn('flex-none text-[11px]', SIGNAL_FAINT)}>
                          {partner.returned > 0
                            ? `${partner.returned} returned`
                            : `${partner.rejectedQuantity} rejected`}
                        </span>
                        <span
                          className={cn(
                            'flex-none text-[12px] font-semibold tabular-nums',
                            partner.openCount > 0 ? WARNING_TEXT : undefined,
                          )}
                        >
                          {partner.ncrCount}
                        </span>
                      </div>
                    ))}
                  </div>
                )}

                <div className={cn('mt-3.5 border-t pt-3', SIGNAL_ROW_DIVIDER)}>
                  <div className="flex items-baseline gap-2">
                    <div className={SIGNAL_EYEBROW}>Awaiting QC inspection</div>
                    <span
                      className={cn(
                        'ml-auto text-[15px] font-extrabold tabular-nums',
                        data.qualityOfSupply.grnBacklog.count > 0
                          ? WARNING_TEXT
                          : undefined,
                      )}
                    >
                      {data.qualityOfSupply.grnBacklog.count}
                    </span>
                  </div>
                  <p className={cn('mt-1 text-[11.5px]', SIGNAL_MUTED)}>
                    {data.qualityOfSupply.grnBacklog.note}
                  </p>
                  {data.qualityOfSupply.grnBacklog.rows.length > 0 && (
                    <div className="mt-1.5">
                      {data.qualityOfSupply.grnBacklog.rows.map((row) => (
                        <div
                          key={row.id}
                          className={cn(
                            'flex items-baseline gap-2 border-b py-1.5 last:border-0',
                            SIGNAL_ROW_DIVIDER,
                          )}
                        >
                          <span className="text-[11.5px] font-semibold tabular-nums">
                            {row.grnNumber}
                          </span>
                          <span className="min-w-0 flex-1 truncate text-[12px]">
                            {row.partyName}
                          </span>
                          <span
                            className={cn(
                              'flex-none text-[11.5px] tabular-nums',
                              row.waitingDays >= 7 ? WARNING_TEXT : SIGNAL_MUTED,
                            )}
                          >
                            {row.waitingDays}d
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>
          </SCard>

          {/* ══ §8 Lead time trend ═══════════════════════════════════════ */}
          <SCard className="p-[18px]">
            <SCardTitle
              title="Quoted lead time trend"
              subtitle="what partners are promising, month by month — the earliest supply-stress signal"
              right={
                <div className="flex items-center gap-2">
                  <DirectionChip direction={data.leadTime.direction} risingIsBad />
                  <ToneChip tone={data.leadTime.averageDays === null ? 'warning' : 'success'}>
                    {days(data.leadTime.averageDays)} average
                  </ToneChip>
                </div>
              }
            />
            <p className={cn('mt-2 text-[11.5px]', SIGNAL_MUTED)}>
              {data.leadTime.note}
            </p>
            <div className="mt-3.5 grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,300px)]">
              <TrendChart
                labels={data.leadTime.trend.map((point) => point.label)}
                series={[
                  {
                    label: 'Average quoted lead time',
                    color: CHART_COLORS.orange,
                    values: data.leadTime.trend.map((point) => point.value),
                    fill: true,
                  },
                ]}
                formatValue={(value) => `${value}d`}
                emptyMessage={`No quote submitted in ${data.period.label} carries a lead time.`}
              />
              <div>
                <div className={SIGNAL_EYEBROW}>
                  By partner · slowest quoted first
                </div>
                {data.leadTime.partners.length === 0 ? (
                  <p className={cn('mt-2 text-[12px]', SIGNAL_FAINT)}>
                    No partner has quoted a lead time yet.
                  </p>
                ) : (
                  <div className="mt-1.5">
                    {data.leadTime.partners.map((partner) => (
                      <div
                        key={partner.key}
                        className={cn(
                          'flex items-baseline gap-2 border-b py-2 last:border-0',
                          SIGNAL_ROW_DIVIDER,
                        )}
                      >
                        <span className="min-w-0 flex-1 truncate text-[12.5px] font-semibold">
                          {partner.partnerName}
                        </span>
                        <span className={cn('flex-none text-[11px]', SIGNAL_FAINT)}>
                          {partner.quotesMeasured} quote(s)
                        </span>
                        <span className="flex-none text-[12px] font-semibold tabular-nums">
                          {partner.averageDays}d
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </SCard>

          {/* ══ What this dashboard is measured from ═════════════════════ */}
          <SCard className="p-[18px]">
            <SCardTitle
              title="What this reads"
              subtitle="the scope and the measurement basis behind every number above"
            />
            <ul className="mt-2.5 space-y-1.5">
              {data.basis.map((entry) => (
                <li
                  key={entry}
                  className={cn('text-[12px] leading-relaxed', SIGNAL_MUTED)}
                >
                  · {entry}
                </li>
              ))}
            </ul>
          </SCard>
        </>
      )}
    </ExecutiveShell>
  );
}

/**
 * One vendor-executed order line, with everything needed to chase it: what it is,
 * how much of the line this vendor holds, where it is, whether it is blocked, and
 * what the vendor last self-reported (and when).
 */
function VendorLineRow({ line }: { line: ScmVendorLine }) {
  const cadenceColor = line.cadenceStatus
    ? CADENCE_COLORS[line.cadenceStatus]
    : null;
  return (
    <div
      className={cn(
        'border-b py-2 last:border-0',
        SIGNAL_ROW_DIVIDER,
      )}
    >
      <div className="flex flex-wrap items-baseline gap-2">
        {cadenceColor && (
          <span
            className={cn(
              'size-[7px] flex-none rounded-full',
              line.updateOverdue && URGENCY_PULSE_CLASS.stale,
            )}
            style={{ background: cadenceColor }}
          />
        )}
        <Link
          href={plmTrackerHref(line.trackerId)}
          className="min-w-0 flex-1 truncate text-[12.5px] font-semibold hover:underline"
        >
          {line.productName}
        </Link>
        <span className={cn('flex-none text-[11px]', SIGNAL_FAINT)}>
          {line.orderNumber} · {line.productSku} · qty {line.splitQuantity}
        </span>
        <span className={cn('flex-none text-[11.5px]', SIGNAL_MUTED)}>
          {PLM_STAGE_LABEL[line.currentStage]}
        </span>
        {line.production.total > 0 && (
          <span className="flex-none text-[11.5px] tabular-nums">
            {line.production.done}/{line.production.total} steps
          </span>
        )}
        <span
          className={cn(
            'flex-none text-[11.5px] font-semibold tabular-nums',
            line.daysUntilDue !== null && line.daysUntilDue < 0
              ? DANGER_TEXT
              : SIGNAL_MUTED,
          )}
        >
          {line.promisedDeliveryDate === null
            ? 'no promised date'
            : line.daysUntilDue !== null && line.daysUntilDue < 0
              ? `${Math.abs(line.daysUntilDue)}d overdue`
              : `due in ${line.daysUntilDue}d`}
        </span>
      </div>
      <div className="mt-1 flex flex-wrap items-baseline gap-x-3 gap-y-1 pl-[15px]">
        {line.blocker && (
          <span className={cn('text-[11.5px] font-semibold', DANGER_TEXT)}>
            Blocked: {line.blocker}
          </span>
        )}
        {/* "Quiet since Tuesday" rather than only "overdue". */}
        <span
          className={cn(
            'text-[11.5px]',
            line.updateOverdue ? DANGER_TEXT : SIGNAL_MUTED,
          )}
        >
          {line.lastUpdateAt
            ? `last self-report ${formatDate(line.lastUpdateAt)}`
            : 'no self-report received yet'}
          {line.cadenceDueAt &&
            ` · next due ${formatDate(line.cadenceDueAt)}`}
        </span>
        {line.selfReport && (
          <span className={cn('text-[11.5px]', SIGNAL_MUTED)}>
            {line.selfReport.reporterDisplayName} reported
            {line.selfReport.stepPercent !== null &&
              ` ${line.selfReport.stepPercent}% of steps`}
            {line.selfReport.fabricationPercent !== null &&
              ` · fabrication ${line.selfReport.fabricationPercent}%`}
            {line.selfReport.surfaceFinishPercent !== null &&
              ` · finish ${line.selfReport.surfaceFinishPercent}%`}
            {line.selfReport.assemblyPercent !== null &&
              ` · assembly ${line.selfReport.assemblyPercent}%`}
          </span>
        )}
        {line.selfReport?.notes && (
          <span className={cn('text-[11.5px] italic', SIGNAL_FAINT)}>
            &ldquo;{line.selfReport.notes}&rdquo;
          </span>
        )}
      </div>
    </div>
  );
}

/**
 * A single number with the backend's own explanation under it. `note` is rendered
 * verbatim: where a metric rests on a substituted clock or a partial match, the
 * page must not restate that in its own words and risk drifting from it.
 */
function MetricBlock({
  label,
  value,
  detail,
  note,
  valueClass,
}: {
  label: string;
  value: string;
  detail?: string | null;
  note: string | null;
  valueClass?: string;
}) {
  return (
    <div>
      <div className={SIGNAL_EYEBROW}>{label}</div>
      <div
        className={cn(
          'mt-0.5 text-[19px] font-extrabold tabular-nums tracking-[-.5px]',
          valueClass,
        )}
      >
        {value}
      </div>
      {detail && (
        <div className={cn('mt-0.5 text-[11.5px]', SIGNAL_MUTED)}>{detail}</div>
      )}
      {note && (
        <p className={cn('mt-1 text-[11px] leading-snug', SIGNAL_FAINT)}>
          {note}
        </p>
      )}
    </div>
  );
}

/**
 * Which way a trend is moving. The backend reports direction raw (RISING /
 * FALLING) because the same direction is good on one metric and bad on another,
 * so the caller says which — here, `risingIsBad` for lead time and NCRs.
 */
function DirectionChip({
  direction,
  risingIsBad,
}: {
  direction: ScmTrendDirection | null;
  risingIsBad: boolean;
}) {
  if (direction === null) {
    return (
      <span className={cn('text-[11px]', SIGNAL_FAINT)}>
        not enough months to call a trend
      </span>
    );
  }
  if (direction === 'FLAT') {
    return <span className={cn('text-[11px]', SIGNAL_MUTED)}>holding flat</span>;
  }
  const rising = direction === 'RISING';
  const bad = rising === risingIsBad;
  const Icon = rising ? TrendingUp : TrendingDown;
  return (
    <span
      className={cn(
        'flex items-center gap-1 text-[11px] font-semibold',
        bad ? WARNING_TEXT : SUCCESS_TEXT,
      )}
    >
      <Icon className="size-3" />
      {rising ? 'rising' : 'falling'}
    </span>
  );
}

/** Days, or an em dash when the data genuinely cannot answer it. */
function days(value: number | null): string {
  return value === null ? '—' : `${value}d`;
}

/** A fixed-2 percentage string, or an em dash. */
function pct(value: string | null): string {
  return value === null ? '—' : `${value}%`;
}

function formatDate(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString('en-IN', {
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
  });
}
