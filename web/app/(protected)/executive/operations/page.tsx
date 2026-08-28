'use client';

/**
 * Executive Dashboards → Operations.
 *
 * Company-wide operational visibility for the COO. Three rules shape the layout:
 *
 *  - **What is on fire reads first.** The overdue band, the single most-overdue
 *    order line and the blocker ranking sit above everything else, in the red /
 *    amber treatment and the `badge-stale` pulse already established for Pings
 *    and the PLM tracker. Healthy detail (funnels, rates, cycle times) follows.
 *  - **Nothing financial.** No revenue, margin, cash flow or receivables figure
 *    appears anywhere. Cost of Poor Quality and the RFQ award premium are the
 *    only monetary numbers, and both are labelled as what they are.
 *  - **Who is executing it, on every line.** Every order line shown anywhere on
 *    this page carries its facility in bold — the external vendor's own name, or
 *    "In-House — Balaji MetalTech" — because "3 days overdue" is unactionable
 *    without knowing whose bench it is sitting on.
 *
 * Delivery urgency, the blocker ranking and the stage funnel are derived here
 * from the PLM workspace's own rows using the same shared helpers the tracker
 * page uses, so a line can never read "overdue" there and "on track" here.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { AlertTriangle, Factory, RefreshCw, Truck } from 'lucide-react';
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
  fetchOperationsDashboard,
  type ExternalVendorHealth,
  type OperationsDashboard,
} from '../../../lib/executive';
import {
  NPD_STAGES,
  PLM_STAGE_LABEL,
  plmTrackerHref,
  type PlmDashboardItem,
} from '../../../lib/plm';
import { portfolioBlockers, priorityProjects } from '../../../lib/dashboard-portfolio';
import {
  DELIVERY_URGENCY_TEXT_CLASS,
  deliveryCountdownLabel,
  deliveryUrgencyTier,
  rollupDeliveryUrgency,
} from '../../../lib/delivery-urgency';
import { URGENCY_PULSE_CLASS } from '../../../lib/urgency';
import { ExecutiveShell } from '../_components/executive-shell';
import {
  CHART_COLORS,
  Donut,
  FunnelBars,
  Gauge,
  KpiTile,
  LegendRow,
} from '../_components/charts';

/** The three health colours the Personal Dashboard donut already established. */
const HEALTH_COLORS = {
  onTrack: '#3DD68C',
  atRisk: '#E08A2C',
  blocked: '#E5484D',
} as const;

const DANGER_TEXT = 'text-[#C13438] dark:text-[#FF8A8D]';
const WARNING_TEXT = 'text-[#C9761B] dark:text-[#E08A2C]';

/** Active lines never sit in COMPLETED, so the funnel stops before it. */
const FUNNEL_STAGES = NPD_STAGES.filter((stage) => stage !== 'COMPLETED');

/** Cool → warm across the flow, so late-stage congestion reads as hotter. */
const STAGE_COLORS = [
  CHART_COLORS.slate,
  CHART_COLORS.teal,
  CHART_COLORS.blue,
  CHART_COLORS.purple,
  CHART_COLORS.blue,
  CHART_COLORS.green,
  CHART_COLORS.orange,
  CHART_COLORS.red,
];

export default function OperationsExecutiveDashboardPage() {
  const { style } = useNumberFormat();
  const [data, setData] = useState<OperationsDashboard | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(() => {
    setLoading(true);
    fetchOperationsDashboard()
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

  const lines = useMemo(() => data?.lines ?? [], [data]);
  const urgency = useMemo(() => rollupDeliveryUrgency(lines), [lines]);
  const blockers = useMemo(() => portfolioBlockers(lines, 6), [lines]);
  const blockedLines = useMemo(
    () => lines.filter((line) => line.blocker),
    [lines],
  );
  const stageFunnel = useMemo(
    () =>
      FUNNEL_STAGES.map((stage, index) => {
        const inStage = lines.filter((line) => line.currentStage === stage);
        const blocked = inStage.filter((line) => line.blocker).length;
        return {
          key: stage,
          label: PLM_STAGE_LABEL[stage],
          count: inStage.length,
          valueLabel:
            inStage.length === 0
              ? '—'
              : `${inStage.length} ${inStage.length === 1 ? 'line' : 'lines'}`,
          note: blocked > 0 ? `${blocked} blocked here` : null,
          color: STAGE_COLORS[index % STAGE_COLORS.length],
        };
      }),
    [lines],
  );
  const money = (value: string | null | undefined) =>
    value === null || value === undefined ? '—' : formatINR(value, style);

  const onFire =
    urgency.overdue +
    blockedLines.length +
    (data?.portfolio.blocked ?? 0) +
    (data?.vendorUpdateHealth.overdue ?? 0);

  return (
    <ExecutiveShell
      active="operations"
      title="Operations Dashboard"
      chip={
        data ? (
          <SignalChip>
            {data.portfolio.activeTotal} active{' '}
            {data.portfolio.activeTotal === 1 ? 'project' : 'projects'}
          </SignalChip>
        ) : undefined
      }
      description={
        data
          ? `Company-wide · as of ${formatDateTime(data.asOf)} · project health, delivery timelines and blockers, worst first`
          : 'Company-wide project health, delivery timelines and blockers'
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
          {/* ══ What is on fire ═══════════════════════════════════════════ */}
          <StatStrip>
            <StatTile
              label="Lines overdue"
              value={urgency.overdue}
              valueClass={urgency.overdue > 0 ? DANGER_TEXT : undefined}
              hint={
                urgency.overdue === 0
                  ? 'Every dated line is still inside its promise'
                  : `past the promised delivery date · worst is ${Math.abs(
                      urgency.mostOverdue?.daysUntilDue ?? 0,
                    )} day(s) over`
              }
            />
            <StatTile
              label="Lines blocked"
              value={blockedLines.length}
              valueClass={blockedLines.length > 0 ? DANGER_TEXT : undefined}
              hint={
                blockers.length === 0
                  ? 'No lifecycle blocker logged'
                  : `top reason: ${blockers[0].reason}`
              }
            />
            <StatTile
              label="Projects blocked"
              value={data.portfolio.blocked}
              valueClass={data.portfolio.blocked > 0 ? DANGER_TEXT : undefined}
              hint={`${data.portfolio.atRisk} more at risk of ${data.portfolio.activeTotal} active`}
            />
            <StatTile
              label="Vendor updates overdue"
              value={data.vendorUpdateHealth.overdue}
              valueClass={
                data.vendorUpdateHealth.overdue > 0 ? DANGER_TEXT : undefined
              }
              hint={
                data.vendorUpdateHealth.note ??
                `${data.vendorUpdateHealth.dueSoon} due soon of ${data.vendorUpdateHealth.measuredLines} on cadence`
              }
            />
          </StatStrip>

          {onFire === 0 && (
            <SCard className="p-[18px]">
              <p className={cn('text-[12.5px]', SIGNAL_MUTED)}>
                Nothing is overdue, blocked, or past its vendor-update cadence
                company-wide. The sections below carry the operating detail.
              </p>
            </SCard>
          )}

          {/* The single worst line, named — not buried in a list. */}
          {urgency.mostOverdue && (
            <MostOverdueLine line={urgency.mostOverdue} />
          )}

          {/* ══ §3 Blockers — the most prominent section ═══════════════════ */}
          <SCard
            className={cn(
              'p-[18px]',
              blockedLines.length > 0 &&
                'border-[#E5484D]/40 bg-[#E5484D]/[.04] dark:bg-[#E5484D]/[.05]',
            )}
          >
            <SCardTitle
              title="Blockers"
              subtitle="every active order line that cannot move, company-wide"
              right={
                <ToneChip tone={blockedLines.length > 0 ? 'danger' : 'success'}>
                  {blockedLines.length === 0
                    ? 'Nothing blocked'
                    : `${blockedLines.length} of ${lines.length} lines`}
                </ToneChip>
              }
            />
            {blockedLines.length === 0 ? (
              <p className={cn('mt-3 text-[12.5px]', SIGNAL_MUTED)}>
                No active order line is blocked. Every line is either progressing
                or waiting on a stage its owner can confirm.
              </p>
            ) : (
              <div className="mt-4 grid gap-5 lg:grid-cols-[minmax(0,320px)_minmax(0,1fr)]">
                {/* Ranked reasons: where to intervene once, not line by line. */}
                <div>
                  <div className={SIGNAL_EYEBROW}>Ranked by lines held up</div>
                  <div className="mt-2.5 space-y-2.5">
                    {blockers.map((blocker, index) => (
                      <div key={blocker.reason}>
                        <div className="flex items-baseline gap-2">
                          <span className="text-[12px] font-semibold">
                            {index + 1}. {blocker.reason}
                          </span>
                          <span className="ml-auto text-[14px] font-extrabold tabular-nums">
                            {blocker.count}
                          </span>
                        </div>
                        <div className="mt-1 h-[9px] overflow-hidden rounded-[3px] bg-black/[.06] dark:bg-white/[.07]">
                          <div
                            className="h-full rounded-[3px]"
                            style={{
                              width: `${Math.max(
                                (blocker.count / blockers[0].count) * 100,
                                2,
                              )}%`,
                              background: HEALTH_COLORS.blocked,
                            }}
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
                {/* The lines themselves, most urgent first, each attributed. */}
                <div>
                  <div className={SIGNAL_EYEBROW}>
                    Blocked lines · soonest due first
                  </div>
                  <div className="mt-1.5">
                    {[...blockedLines]
                      .sort(
                        (left, right) =>
                          (left.daysUntilDue ?? Number.POSITIVE_INFINITY) -
                          (right.daysUntilDue ?? Number.POSITIVE_INFINITY),
                      )
                      .slice(0, 8)
                      .map((line) => (
                        <LineRow key={line.trackerId} line={line} />
                      ))}
                  </div>
                  {blockedLines.length > 8 && (
                    <p className={cn('mt-2 text-[11px]', SIGNAL_FAINT)}>
                      {blockedLines.length - 8} further blocked{' '}
                      {blockedLines.length - 8 === 1 ? 'line' : 'lines'} not shown
                      — see the PLM workspace for the full queue.
                    </p>
                  )}
                </div>
              </div>
            )}
          </SCard>

          {/* ══ §2 Delivery timeline urgency + §1 portfolio health ════════ */}
          <div className="grid gap-4 lg:grid-cols-2">
            <SCard className="p-[18px]">
              <SCardTitle
                title="Delivery timeline urgency"
                subtitle="every active order line against its promised delivery date"
                right={
                  <ToneChip tone={urgency.overdue > 0 ? 'danger' : 'success'}>
                    {urgency.overdue} overdue
                  </ToneChip>
                }
              />
              <div className="mt-4 flex flex-wrap items-center gap-5">
                <Donut
                  centerValue={String(urgency.measured)}
                  centerLabel="dated lines"
                  slices={[
                    {
                      label: 'On track',
                      value: urgency.onTrack,
                      color: HEALTH_COLORS.onTrack,
                      percentLabel: null,
                    },
                    {
                      label: 'At risk',
                      value: urgency.atRisk,
                      color: HEALTH_COLORS.atRisk,
                      percentLabel: null,
                    },
                    {
                      label: 'Overdue',
                      value: urgency.overdue,
                      color: HEALTH_COLORS.blocked,
                      percentLabel: null,
                    },
                  ]}
                />
                <div className="min-w-[210px] flex-1 space-y-1.5">
                  <LegendRow
                    color={HEALTH_COLORS.onTrack}
                    label="On track · more than a week out"
                    value={String(urgency.onTrack)}
                    percentLabel={null}
                  />
                  <LegendRow
                    color={HEALTH_COLORS.atRisk}
                    label="At risk · due within 7 days"
                    value={String(urgency.atRisk)}
                    percentLabel={null}
                  />
                  <LegendRow
                    color={HEALTH_COLORS.blocked}
                    label="Overdue · past the promise"
                    value={String(urgency.overdue)}
                    percentLabel={null}
                  />
                  {urgency.unconfirmed > 0 && (
                    <p className={cn('pt-1 text-[11px]', SIGNAL_FAINT)}>
                      {urgency.unconfirmed}{' '}
                      {urgency.unconfirmed === 1 ? 'line has' : 'lines have'} no
                      promised delivery date on the confirmation sheet and are
                      counted in none of the three buckets.
                    </p>
                  )}
                </div>
              </div>
              {urgency.overdueLines.length > 1 && (
                <div className={cn('mt-4 border-t pt-3', SIGNAL_ROW_DIVIDER)}>
                  <div className={SIGNAL_EYEBROW}>Other overdue lines</div>
                  <div className="mt-1.5">
                    {urgency.overdueLines.slice(1, 5).map((line) => (
                      <LineRow key={line.trackerId} line={line} />
                    ))}
                  </div>
                </div>
              )}
            </SCard>

            <SCard className="p-[18px]">
              <SCardTitle
                title="Company-wide portfolio health"
                subtitle="every active project, not just the ones you attended"
                right={
                  <span className={cn('text-[11px] tabular-nums', SIGNAL_FAINT)}>
                    {data.portfolio.totalEverStarted} started to date
                  </span>
                }
              />
              {data.portfolio.activeTotal === 0 ? (
                <p className={cn('mt-3 text-[12.5px]', SIGNAL_MUTED)}>
                  No project is currently active company-wide.
                </p>
              ) : (
                <>
                  <div className="mt-4 flex flex-wrap items-center gap-5">
                    <Donut
                      centerValue={String(data.portfolio.activeTotal)}
                      centerLabel="active"
                      slices={[
                        {
                          label: 'On track',
                          value: data.portfolio.onTrack,
                          color: HEALTH_COLORS.onTrack,
                          percentLabel: null,
                        },
                        {
                          label: 'At risk',
                          value: data.portfolio.atRisk,
                          color: HEALTH_COLORS.atRisk,
                          percentLabel: null,
                        },
                        {
                          label: 'Blocked',
                          value: data.portfolio.blocked,
                          color: HEALTH_COLORS.blocked,
                          percentLabel: null,
                        },
                      ]}
                    />
                    <div className="min-w-[190px] flex-1 space-y-1.5">
                      <LegendRow
                        color={HEALTH_COLORS.onTrack}
                        label="On track"
                        value={String(data.portfolio.onTrack)}
                        percentLabel={null}
                      />
                      <LegendRow
                        color={HEALTH_COLORS.atRisk}
                        label="At risk"
                        value={String(data.portfolio.atRisk)}
                        percentLabel={null}
                      />
                      <LegendRow
                        color={HEALTH_COLORS.blocked}
                        label="Blocked"
                        value={String(data.portfolio.blocked)}
                        percentLabel={null}
                      />
                    </div>
                  </div>
                  <div className={cn('mt-4 border-t pt-3', SIGNAL_ROW_DIVIDER)}>
                    <div className={SIGNAL_EYEBROW}>Needs attention first</div>
                    <div className="mt-1.5">
                      {priorityProjects(data.portfolio.projects, 4).map(
                        (project) => (
                          <div
                            key={project.kickoffId}
                            className={cn(
                              'flex items-start gap-2.5 border-b py-2 last:border-0',
                              SIGNAL_ROW_DIVIDER,
                            )}
                          >
                            <span
                              className="mt-[5px] size-[7px] shrink-0 rounded-full"
                              style={{
                                background:
                                  project.health === 'BLOCKED'
                                    ? HEALTH_COLORS.blocked
                                    : project.health === 'AT_RISK'
                                      ? HEALTH_COLORS.atRisk
                                      : HEALTH_COLORS.onTrack,
                              }}
                            />
                            <div className="min-w-0 flex-1">
                              <div className="truncate text-[12.5px] font-semibold">
                                {project.projectName}
                              </div>
                              <div
                                className={cn(
                                  'mt-0.5 text-[11px]',
                                  SIGNAL_FAINT,
                                )}
                              >
                                {project.orderNumber} · {project.currentStage} ·{' '}
                                {project.healthReason}
                              </div>
                            </div>
                          </div>
                        ),
                      )}
                    </div>
                  </div>
                </>
              )}
            </SCard>
          </div>

          {/* ══ §4 PLM stage funnel + §5 OTD ══════════════════════════════ */}
          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,340px)]">
            <SCard className="p-[18px]">
              <SCardTitle
                title="PLM stage funnel"
                subtitle="how many active order lines sit at each stage — where the queue is"
                right={
                  <span className={cn('text-[11px] tabular-nums', SIGNAL_FAINT)}>
                    {lines.length} active {lines.length === 1 ? 'line' : 'lines'}
                  </span>
                }
              />
              <div className="mt-4">
                {lines.length === 0 ? (
                  <p className={cn('text-[12.5px]', SIGNAL_MUTED)}>
                    No active PLM tracker company-wide, so there is no stage
                    distribution to show.
                  </p>
                ) : (
                  <FunnelBars stages={stageFunnel} />
                )}
              </div>
            </SCard>

            <SCard className="p-[18px]">
              <SCardTitle
                title="On-time delivery"
                subtitle="Logistics OTD analytics, unchanged"
                right={
                  <ToneChip
                    tone={
                      data.onTimeDelivery.status === 'AVAILABLE'
                        ? 'success'
                        : 'neutral'
                    }
                  >
                    {data.onTimeDelivery.status === 'AVAILABLE'
                      ? `${data.onTimeDelivery.totalDelivered} delivered`
                      : 'Not measurable'}
                  </ToneChip>
                }
              />
              <div className="mt-4 flex flex-wrap items-center gap-4">
                <Gauge
                  percent={data.onTimeDelivery.percent}
                  label="on time"
                  color={CHART_COLORS.green}
                />
                <div className="min-w-[130px] flex-1 space-y-1.5">
                  {data.onTimeDelivery.status === 'AVAILABLE' ? (
                    <>
                      <SmallRow
                        label="On time"
                        value={String(data.onTimeDelivery.onTime)}
                      />
                      <SmallRow
                        label="Late"
                        value={String(data.onTimeDelivery.late)}
                        tone={data.onTimeDelivery.late > 0 ? 'danger' : undefined}
                      />
                      <SmallRow
                        label="Avg delay when late"
                        value={`${data.onTimeDelivery.averageDelayDays} d`}
                      />
                    </>
                  ) : (
                    <p className={cn('text-[12px]', SIGNAL_MUTED)}>
                      {data.onTimeDelivery.note}
                    </p>
                  )}
                </div>
              </div>
            </SCard>
          </div>

          {/* ══ §12 Balaji MetalTech: in-house depth ══════════════════════ */}
          <SCard className="p-[18px]">
            <SCardTitle
              title={
                <span className="inline-flex items-center gap-2">
                  <Factory className="size-4 text-black/45 dark:text-white/40" />
                  {data.facilities.inHouse.label}
                </span>
              }
              subtitle="our own plant — measured from the Kanban board we run, not self-reported"
              right={
                <ToneChip
                  tone={
                    data.facilities.inHouse.blockedLines > 0
                      ? 'danger'
                      : 'neutral'
                  }
                >
                  {data.facilities.inHouse.activeLines} active{' '}
                  {data.facilities.inHouse.activeLines === 1 ? 'line' : 'lines'}
                </ToneChip>
              }
            />
            <div className="mt-4 grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-black/10 bg-black/10 md:grid-cols-4 dark:border-white/[.08] dark:bg-white/[.08]">
              <KpiTile
                label="Card completion"
                value={
                  data.facilities.inHouse.production.percent === null
                    ? '—'
                    : `${data.facilities.inHouse.production.percent}%`
                }
                hint={
                  data.facilities.inHouse.production.note ??
                  `${data.facilities.inHouse.production.done} of ${data.facilities.inHouse.production.total} production cards done`
                }
              />
              <KpiTile
                label="WIP load"
                value={String(data.facilities.inHouse.activeLines)}
                hint={`${data.facilities.inHouse.linesInProduction} currently on the production floor`}
              />
              <KpiTile
                label="Blocked here"
                value={String(data.facilities.inHouse.blockedLines)}
                tone={
                  data.facilities.inHouse.blockedLines > 0
                    ? 'negative'
                    : undefined
                }
                hint="in-house lines that cannot move"
              />
              <KpiTile
                label="In-house OTD"
                value={
                  data.facilities.inHouse.onTimeDelivery.percent === null
                    ? '—'
                    : `${data.facilities.inHouse.onTimeDelivery.percent.toFixed(1)}%`
                }
                hint={
                  data.facilities.inHouse.onTimeDelivery.status === 'AVAILABLE'
                    ? `${data.facilities.inHouse.onTimeDelivery.onTime} of ${data.facilities.inHouse.onTimeDelivery.totalDelivered} challans on time`
                    : data.facilities.inHouse.onTimeDelivery.note
                }
              />
            </div>
            <p className={cn('mt-2.5 text-[11px]', SIGNAL_FAINT)}>
              {data.facilities.inHouse.onTimeDelivery.note}
              {data.facilities.mixedDispatchesExcluded > 0 &&
                ` · ${data.facilities.mixedDispatchesExcluded} challan${
                  data.facilities.mixedDispatchesExcluded === 1 ? '' : 's'
                } mixed in-house with vendor work and are excluded from both segments.`}
            </p>
            <InHouseBlockers lines={lines} />
          </SCard>

          {/* ══ §7/§11 External vendors: the shallower self-reported view ══ */}
          <SCard className="p-[18px]">
            <SCardTitle
              title={
                <span className="inline-flex items-center gap-2">
                  <Truck className="size-4 text-black/45 dark:text-white/40" />
                  External vendors
                </span>
              }
              subtitle="self-reported progress and update cadence — shallower by nature than our own plant"
              right={
                <ToneChip
                  tone={
                    data.vendorUpdateHealth.overdue > 0 ? 'danger' : 'success'
                  }
                >
                  {data.vendorUpdateHealth.overdue} overdue ·{' '}
                  {data.vendorUpdateHealth.dueSoon} due soon
                </ToneChip>
              }
            />
            {data.facilities.externalVendors.length === 0 ? (
              <p className={cn('mt-3 text-[12.5px]', SIGNAL_MUTED)}>
                No active order line is with an external vendor.
              </p>
            ) : (
              <div className="mt-3">
                {data.facilities.externalVendors.map((vendor) => (
                  <VendorRow key={vendor.key} vendor={vendor} />
                ))}
              </div>
            )}
            <p className={cn('mt-2.5 text-[11px]', SIGNAL_FAINT)}>
              Percentages here are what the vendor last told us through the
              update portal. They are not measured against a board we control —
              unlike {data.facilities.inHouse.label} above.
            </p>
          </SCard>

          {/* ══ §6 Design stage bottlenecks + §8 procurement ══════════════ */}
          <div className="grid gap-4 lg:grid-cols-2">
            <SCard className="p-[18px]">
              <SCardTitle
                title="Design engineering stage gates"
                subtitle="active design projects per stage, against their target dates"
                right={
                  <ToneChip
                    tone={data.design.overdueTotal > 0 ? 'danger' : 'success'}
                  >
                    {data.design.overdueTotal} past target
                  </ToneChip>
                }
              />
              {data.design.activeTotal === 0 ? (
                <p className={cn('mt-3 text-[12.5px]', SIGNAL_MUTED)}>
                  No design project is currently active.
                </p>
              ) : (
                <>
                  <div className="mt-3.5 space-y-2">
                    {[...data.design.stages, ...data.design.offLadder].map(
                      (stage) => (
                        <div
                          key={stage.status}
                          className="flex items-baseline gap-2"
                        >
                          <span className="text-[12px] font-medium">
                            {stage.label}
                          </span>
                          {stage.overdueCount > 0 && (
                            <span
                              className={cn(
                                'rounded-[4px] bg-[#E5484D]/[.14] px-1.5 py-[1px] text-[10px] font-semibold',
                                DANGER_TEXT,
                              )}
                            >
                              {stage.overdueCount} past target
                            </span>
                          )}
                          <span className="ml-auto text-[13px] font-extrabold tabular-nums">
                            {stage.count}
                          </span>
                        </div>
                      ),
                    )}
                  </div>
                  {data.design.overdueProjects.length > 0 && (
                    <div className={cn('mt-3.5 border-t pt-3', SIGNAL_ROW_DIVIDER)}>
                      <div className={SIGNAL_EYEBROW}>
                        Stuck against target date
                      </div>
                      <div className="mt-1.5">
                        {data.design.overdueProjects.map((project) => (
                          <div
                            key={project.id}
                            className={cn(
                              'flex items-baseline gap-2 border-b py-1.5 last:border-0',
                              SIGNAL_ROW_DIVIDER,
                            )}
                          >
                            <span className="truncate text-[12px] font-medium">
                              {project.projectNumber} · {project.name}
                            </span>
                            <span
                              className={cn(
                                'ml-auto shrink-0 text-[11px] font-semibold tabular-nums',
                                DANGER_TEXT,
                              )}
                            >
                              {project.daysOverdue} d over · {project.stageLabel}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </>
              )}
            </SCard>

            <SCard className="p-[18px]">
              <SCardTitle
                title="Procurement cycle health"
                subtitle="sourcing speed and the queues behind incoming material"
                right={
                  <ToneChip
                    tone={
                      data.procurement.overduePurchaseOrders.count > 0
                        ? 'danger'
                        : 'success'
                    }
                  >
                    {data.procurement.overduePurchaseOrders.count} overdue PO
                    {data.procurement.overduePurchaseOrders.count === 1
                      ? ''
                      : 's'}
                  </ToneChip>
                }
              />
              <div className="mt-3.5 grid grid-cols-2 gap-3.5 sm:grid-cols-4">
                <SmallStat
                  label="RFQ cycle"
                  value={
                    data.procurement.rfqCycle.averageDays === null
                      ? '—'
                      : `${data.procurement.rfqCycle.averageDays} d`
                  }
                  hint={
                    data.procurement.rfqCycle.averageDays === null
                      ? data.procurement.rfqCycle.note
                      : `${data.procurement.rfqCycle.rfqsMeasured} awarded`
                  }
                />
                <SmallStat
                  label="Overdue POs"
                  value={String(data.procurement.overduePurchaseOrders.count)}
                  hint="past expected delivery"
                  tone={
                    data.procurement.overduePurchaseOrders.count > 0
                      ? 'danger'
                      : undefined
                  }
                />
                <SmallStat
                  label="GRN awaiting QC"
                  value={String(data.procurement.grnPendingQc)}
                  hint="received, not inspected"
                  tone={
                    data.procurement.grnPendingQc > 0 ? 'warning' : undefined
                  }
                />
                <SmallStat
                  label="Inspection backlog"
                  value={String(data.procurement.inspectionBacklog)}
                  hint="raised, not concluded"
                  tone={
                    data.procurement.inspectionBacklog > 0
                      ? 'warning'
                      : undefined
                  }
                />
              </div>
              {data.procurement.overduePurchaseOrders.orders.length > 0 && (
                <div className={cn('mt-3.5 border-t pt-3', SIGNAL_ROW_DIVIDER)}>
                  <div className={SIGNAL_EYEBROW}>Overdue purchase orders</div>
                  <div className="mt-1.5">
                    {data.procurement.overduePurchaseOrders.orders.map((po) => (
                      <div
                        key={po.id}
                        className={cn(
                          'flex items-baseline gap-2 border-b py-1.5 last:border-0',
                          SIGNAL_ROW_DIVIDER,
                        )}
                      >
                        <span className="text-[12px] font-medium">
                          {po.poNumber}
                        </span>
                        <span className="truncate text-[11.5px] font-bold">
                          {po.partyName}
                        </span>
                        <span
                          className={cn(
                            'ml-auto shrink-0 text-[11px] tabular-nums',
                            SIGNAL_FAINT,
                          )}
                        >
                          due {formatDate(po.expectedDeliveryDate)}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              <div className={cn('mt-3.5 border-t pt-3', SIGNAL_ROW_DIVIDER)}>
                <div className={SIGNAL_EYEBROW}>
                  Award premium over lowest quote
                </div>
                <div className="mt-1 flex flex-wrap items-baseline gap-2">
                  <span className="text-[17px] font-extrabold tracking-[-.7px] tabular-nums">
                    {data.procurement.awardPremium.status === 'AVAILABLE'
                      ? money(data.procurement.awardPremium.amount)
                      : '—'}
                  </span>
                  {data.procurement.awardPremium.percent !== null && (
                    <ToneChip tone="neutral">
                      +
                      {Number(data.procurement.awardPremium.percent).toFixed(1)}%
                      over lowest
                    </ToneChip>
                  )}
                </div>
                <p className={cn('mt-1.5 text-[11px]', SIGNAL_FAINT)}>
                  A sourcing-effectiveness signal, not a financial one: how much
                  the awarded quotes cost above the cheapest quotes received,
                  across {data.procurement.awardPremium.rfqsMeasured} measurable
                  award
                  {data.procurement.awardPremium.rfqsMeasured === 1 ? '' : 's'}
                  {data.procurement.awardPremium.rfqsUnmeasured > 0 &&
                    ` (${data.procurement.awardPremium.rfqsUnmeasured} not measurable)`}
                  .
                </p>
              </div>
            </SCard>
          </div>

          {/* ══ §9 Quality: cost of poor quality, as a quality signal ══════ */}
          <SCard className="p-[18px]">
            <SCardTitle
              title="Quality cost and open non-conformances"
              subtitle={`${data.period.label} to date`}
              right={
                <ToneChip
                  tone={data.quality.openNcrCount > 0 ? 'warning' : 'success'}
                >
                  {data.quality.openNcrCount} open NCR
                  {data.quality.openNcrCount === 1 ? '' : 's'}
                </ToneChip>
              }
            />
            <div className="mt-3.5 grid grid-cols-2 gap-3.5 sm:grid-cols-3">
              <SmallStat
                label="Cost of poor quality"
                value={
                  data.quality.copqTotal === null
                    ? '—'
                    : money(data.quality.copqTotal)
                }
                hint={
                  data.quality.status === 'AVAILABLE'
                    ? `${data.quality.ncrsCosted} costed non-conformances`
                    : data.quality.note
                }
                tone={data.quality.copqTotal === null ? undefined : 'warning'}
              />
              <SmallStat
                label="Manually costed"
                value={String(data.quality.manuallyCosted)}
                hint="entered by hand rather than derived"
              />
              <SmallStat
                label="Open NCRs"
                value={String(data.quality.openNcrCount)}
                hint="still being worked"
                tone={data.quality.openNcrCount > 0 ? 'warning' : undefined}
              />
            </div>
            <p className={cn('mt-2.5 text-[11px]', SIGNAL_FAINT)}>
              Scrap and rework cost is shown as a quality-failure signal — it is
              the only cost figure on this dashboard alongside the award premium,
              and neither is revenue, margin, cash flow or receivables.
            </p>
          </SCard>

          {/* ══ The rules every figure above was computed under ═══════════ */}
          <SCard className="p-[18px]">
            <SCardTitle title="Basis and exclusions" />
            <ul className="mt-2.5 space-y-1.5">
              {data.basis.map((entry) => (
                <li
                  key={entry}
                  className={cn('text-[12px] leading-relaxed', SIGNAL_MUTED)}
                >
                  {entry}
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
 * The single most-overdue order line, called out at the top of the page with the
 * same pulsing red treatment Pings and the PLM tracker use for a stale item. One
 * line, named, with who is executing it — not a row in a table.
 */
function MostOverdueLine({ line }: { line: PlmDashboardItem }) {
  const daysOver = Math.abs(line.daysUntilDue ?? 0);
  return (
    <div
      className={cn(
        'rounded-[11px] border border-[#E5484D]/45 bg-[#E5484D]/[.07] p-[18px]',
        URGENCY_PULSE_CLASS.stale,
      )}
    >
      <div className="flex items-center gap-2">
        <AlertTriangle className={cn('size-4', DANGER_TEXT)} />
        <span
          className={cn(
            'text-[10px] font-semibold uppercase tracking-[.14em]',
            DANGER_TEXT,
          )}
        >
          Most overdue line company-wide
        </span>
      </div>
      <div className="mt-2.5 flex flex-wrap items-end gap-x-5 gap-y-2">
        <div>
          <div className={cn('text-[30px] font-extrabold leading-none tracking-[-1.4px] tabular-nums', DANGER_TEXT)}>
            {daysOver} <span className="text-[16px] tracking-normal">d over</span>
          </div>
          <div className={cn('mt-1.5 text-[11px]', SIGNAL_FAINT)}>
            promised {formatDate(line.promisedDeliveryDate)}
          </div>
        </div>
        <div className="min-w-[220px] flex-1">
          <div className="text-[14.5px] font-bold tracking-[-.3px]">
            {line.productName}
          </div>
          <div className={cn('mt-1 text-[11.5px]', SIGNAL_MUTED)}>
            {line.orderNumber}
            {line.customerName ? ` · ${line.customerName}` : ''} ·{' '}
            {PLM_STAGE_LABEL[line.currentStage]} · {line.splitQuantity} qty
          </div>
          <div className="mt-1.5">
            <FacilityLabel line={line} />
          </div>
          {line.blocker && (
            <div className={cn('mt-1.5 text-[11.5px] font-semibold', DANGER_TEXT)}>
              Blocked: {line.blocker}
            </div>
          )}
        </div>
        <Link
          href={plmTrackerHref(line.trackerId)}
          className={cn(SIGNAL_BTN_GHOST, 'shrink-0')}
        >
          Open tracker
        </Link>
      </div>
    </div>
  );
}

/**
 * One order line anywhere on this page. The facility is always rendered, in
 * bold, alongside the delivery countdown in its urgency colour — the two facts
 * a COO needs before deciding who to call.
 */
function LineRow({ line }: { line: PlmDashboardItem }) {
  const tier = deliveryUrgencyTier(line.daysUntilDue);
  return (
    <div
      className={cn(
        'flex flex-wrap items-baseline gap-x-2 gap-y-1 border-b py-2 last:border-0',
        SIGNAL_ROW_DIVIDER,
      )}
    >
      <Link
        href={plmTrackerHref(line.trackerId)}
        className="text-[12.5px] font-semibold hover:underline"
      >
        {line.productName}
      </Link>
      <span className={cn('text-[11px]', SIGNAL_FAINT)}>
        {line.orderNumber}
        {line.customerName ? ` · ${line.customerName}` : ''}
      </span>
      <span
        className={cn(
          'ml-auto shrink-0 text-[11px] font-semibold tabular-nums',
          DELIVERY_URGENCY_TEXT_CLASS[tier],
        )}
      >
        {deliveryCountdownLabel(line.daysUntilDue)}
      </span>
      <div className="w-full">
        <FacilityLabel line={line} />
        {line.blocker && (
          <span className={cn('ml-2 text-[11px]', SIGNAL_MUTED)}>
            {PLM_STAGE_LABEL[line.currentStage]} · {line.blocker}
          </span>
        )}
      </div>
    </div>
  );
}

/**
 * Who is executing this line — bold, on every line, everywhere on this page.
 *
 * The label comes from the server, derived from the delivery flow rather than
 * from a vendor name that may be blank: IN_HOUSE work is our own plant, an NPD
 * line with no vendor is our own development, and anything else is a genuine
 * external vendor shown under its own name so the two never read alike.
 */
function FacilityLabel({ line }: { line: PlmDashboardItem }) {
  const external = line.facilityKind === 'EXTERNAL_VENDOR';
  const Icon = external ? Truck : Factory;
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 text-[11.5px] font-bold',
        external
          ? 'text-black/70 dark:text-white/[.72]'
          : 'text-[#3B6FB5] dark:text-[#6FA3E0]',
      )}
    >
      <Icon className="size-3.5 opacity-70" />
      {line.facilityLabel}
      {line.vendorCadenceStatus === 'RED' && (
        <span className={cn('font-semibold', DANGER_TEXT)}>
          · update overdue
        </span>
      )}
      {line.vendorCadenceStatus === 'AMBER' && (
        <span className={cn('font-semibold', WARNING_TEXT)}>· update due</span>
      )}
    </span>
  );
}

/**
 * In-house blockers called out distinctly from the vendor ones: these are ours
 * to fix directly, so they are listed rather than only counted.
 */
function InHouseBlockers({ lines }: { lines: PlmDashboardItem[] }) {
  const blocked = lines.filter(
    (line) => line.facilityKind !== 'EXTERNAL_VENDOR' && line.blocker,
  );
  if (blocked.length === 0) return null;
  return (
    <div className={cn('mt-3.5 border-t pt-3', SIGNAL_ROW_DIVIDER)}>
      <div className={cn(SIGNAL_EYEBROW, DANGER_TEXT)}>
        Blocked in-house — ours to clear
      </div>
      <div className="mt-1.5">
        {blocked.slice(0, 5).map((line) => (
          <LineRow key={line.trackerId} line={line} />
        ))}
      </div>
    </div>
  );
}

/** One external vendor: the shallow self-reported view, under its own name. */
function VendorRow({ vendor }: { vendor: ExternalVendorHealth }) {
  const report = vendor.latestSelfReport;
  return (
    <div className={cn('border-b py-2.5 last:border-0', SIGNAL_ROW_DIVIDER)}>
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <span className="inline-flex items-center gap-1.5 text-[12.5px] font-bold">
          <Truck className="size-3.5 opacity-70" />
          {vendor.vendorName}
        </span>
        {vendor.vendorId === null && (
          <span className={cn('text-[10.5px]', SIGNAL_FAINT)}>
            not linked to a Vendor Master record
          </span>
        )}
        <span className={cn('ml-auto text-[11px] tabular-nums', SIGNAL_FAINT)}>
          {vendor.activeLines} active{' '}
          {vendor.activeLines === 1 ? 'line' : 'lines'}
        </span>
      </div>
      <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px]">
        {vendor.overdue > 0 && (
          <span className={cn('font-semibold', DANGER_TEXT)}>
            {vendor.overdue} update{vendor.overdue === 1 ? '' : 's'} overdue
          </span>
        )}
        {vendor.dueSoon > 0 && (
          <span className={cn('font-semibold', WARNING_TEXT)}>
            {vendor.dueSoon} due soon
          </span>
        )}
        {vendor.onSchedule > 0 && (
          <span className="font-semibold text-[#1E9E63] dark:text-[#3DD68C]">
            {vendor.onSchedule} on schedule
          </span>
        )}
        {vendor.blockedLines > 0 && (
          <span className={cn('font-semibold', DANGER_TEXT)}>
            {vendor.blockedLines} blocked
          </span>
        )}
        {report ? (
          <span className={SIGNAL_MUTED}>
            self-reported{' '}
            {report.stepPercent === null ? '' : `${report.stepPercent}% of steps · `}
            fab {report.fabricationPercent ?? '—'}% · finish{' '}
            {report.surfaceFinishPercent ?? '—'}% · assembly{' '}
            {report.assemblyPercent ?? '—'}% · {formatDate(report.reportedAt)} by{' '}
            {report.reporterDisplayName}
          </span>
        ) : (
          <span className={SIGNAL_FAINT}>no self-reported update yet</span>
        )}
      </div>
    </div>
  );
}

/** Label / value row inside a chart card. */
function SmallRow({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: 'danger';
}) {
  return (
    <div className="flex items-baseline gap-2 text-[11.5px]">
      <span className={SIGNAL_MUTED}>{label}</span>
      <span
        className={cn(
          'ml-auto font-bold tabular-nums',
          tone === 'danger' && DANGER_TEXT,
        )}
      >
        {value}
      </span>
    </div>
  );
}

/** Compact stat inside a card (smaller than the page-level KPI tiles). */
function SmallStat({
  label,
  value,
  hint,
  tone,
}: {
  label: string;
  value: string;
  hint?: string | null;
  tone?: 'danger' | 'warning';
}) {
  return (
    <div>
      <div className={SIGNAL_EYEBROW}>{label}</div>
      <div
        className={cn(
          'mt-1.5 text-[17px] font-extrabold leading-none tracking-[-.7px] tabular-nums',
          tone === 'danger' && DANGER_TEXT,
          tone === 'warning' && WARNING_TEXT,
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
