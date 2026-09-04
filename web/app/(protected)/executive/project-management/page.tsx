'use client';

/**
 * Executive Dashboards → Project Management.
 *
 * The PM Head's question is narrower than the COO's: not "is delivery healthy"
 * but "which project, owned by which PM, needs me today". Four rules shape the
 * layout:
 *
 *  - **Every row names its PM.** Aggregates exist only to rank the named rows
 *    beneath them; no section stops at a count. A donut that says "3 at risk"
 *    without saying whose is useless here.
 *  - **One number, one source.** Health badges, overdue tests and the promised
 *    delivery clock come from the backend, which reuses the same builders the
 *    PLM rows and the Operations dashboard use. The delivery tiering here is the
 *    shared `deliveryUrgencyTier` scale and the ping ageing is the shared 24h
 *    boundary, so nothing is re-derived on this page.
 *  - **`null` is rendered, not filled in.** A percentage with no denominator
 *    arrives null and shows as an em dash next to the section's own note, which
 *    explains why. Never a 0% that reads as "measured and fine".
 *  - **Filtering is honest.** The PM filter narrows the lists and every figure
 *    this page can recompute exactly from a complete row set (project health,
 *    delivery, workload). Sections whose rows arrive capped keep their
 *    portfolio-wide totals and say so.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { AlertTriangle, Flag, RefreshCw, ShieldAlert } from 'lucide-react';
import {
  Callout,
  SCard,
  SCardTitle,
  SignalChip,
  SIGNAL_BTN_GHOST,
  SIGNAL_EYEBROW,
  SIGNAL_FAINT,
  SIGNAL_LINK,
  SIGNAL_MUTED,
  SIGNAL_ROW_DIVIDER,
  StatStrip,
  StatTile,
  ToneChip,
} from '../../../components/ui/signal';
import { cn } from '../../../lib/utils';
import {
  fetchProjectManagementDashboard,
  type PmAgeBucket,
  type ProjectHealth,
  type ProjectManagementDashboard,
} from '../../../lib/executive';
import {
  DELIVERY_URGENCY_TEXT_CLASS,
  deliveryCountdownLabel,
  deliveryUrgencyTier,
  type DeliveryUrgencyTier,
} from '../../../lib/delivery-urgency';
import { AGING_AFTER_HOURS, urgencyTier } from '../../../lib/urgency';
import { linkedPingHref } from '../../../lib/pings';
import { ExecutiveShell } from '../_components/executive-shell';
import {
  CHART_COLORS,
  Donut,
  FunnelBars,
  Gauge,
  LegendRow,
  SplitBar,
} from '../_components/charts';

const DANGER_TEXT = 'text-[#C13438] dark:text-[#FF8A8D]';
const WARNING_TEXT = 'text-[#C9761B] dark:text-[#E08A2C]';
const SUCCESS_TEXT = 'text-[#1E9E63] dark:text-[#3DD68C]';

/** The three health states, coloured as everywhere else in the app. */
const HEALTH_COLOR: Record<ProjectHealth, string> = {
  ON_TRACK: CHART_COLORS.green,
  AT_RISK: CHART_COLORS.orange,
  BLOCKED: CHART_COLORS.red,
};
const HEALTH_TONE: Record<ProjectHealth, 'success' | 'warning' | 'danger'> = {
  ON_TRACK: 'success',
  AT_RISK: 'warning',
  BLOCKED: 'danger',
};

/** The delivery-urgency scale, ordered worst-first for the split bar. */
const DELIVERY_TIERS: Array<{
  tier: DeliveryUrgencyTier;
  label: string;
  color: string;
}> = [
  { tier: 'OVERDUE', label: 'Overdue', color: CHART_COLORS.red },
  { tier: 'URGENT', label: 'Due within 2 days', color: '#E5484D' },
  {
    tier: 'APPROACHING',
    label: 'Due within a week',
    color: CHART_COLORS.orange,
  },
  {
    tier: 'ON_TRACK',
    label: 'More than a week out',
    color: CHART_COLORS.green,
  },
  { tier: 'UNCONFIRMED', label: 'No promised date', color: CHART_COLORS.slate },
];

const ACTION_STATUS_COLOR: Record<string, string> = {
  TODO: CHART_COLORS.slate,
  IN_PROGRESS: CHART_COLORS.blue,
  DONE: CHART_COLORS.green,
  ARCHIVED: CHART_COLORS.purple,
  UNLINKED: CHART_COLORS.orange,
};

const MATRIX_LEVELS = ['HIGH', 'MEDIUM', 'LOW'] as const;

const date = (value: string | null | undefined) =>
  value ? new Date(value).toLocaleDateString() : '—';
const dateTime = (value: string) => new Date(value).toLocaleString();
const percent = (value: string | null | undefined) =>
  value === null || value === undefined ? '—' : `${Number(value).toFixed(1)}%`;
const number = (value: number | null | undefined) =>
  value === null || value === undefined ? '—' : String(value);
const titleCase = (value: string) =>
  value
    .toLowerCase()
    .split('_')
    .map((word) => (word ? word[0].toUpperCase() + word.slice(1) : word))
    .join(' ');

/** Hairline-divided list row, the shape every named list on this page uses. */
function Row({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'border-b py-2.5 last:border-b-0',
        SIGNAL_ROW_DIVIDER,
        className,
      )}
    >
      {children}
    </div>
  );
}

/**
 * Horizontal bars for a pre-counted bucket ladder. The backend does the
 * bucketing, so this only draws — an empty ladder still renders its rungs
 * rather than collapsing to nothing.
 */
function BucketBars({
  buckets,
  color = CHART_COLORS.blue,
  unit,
}: {
  buckets: PmAgeBucket[];
  color?: string;
  unit: string;
}) {
  const max = Math.max(...buckets.map((bucket) => bucket.count), 1);
  const total = buckets.reduce((sum, bucket) => sum + bucket.count, 0);
  return (
    <div className="space-y-2">
      {buckets.map((bucket) => (
        <div key={bucket.key} className="flex items-center gap-3">
          <span
            className={cn('w-[76px] flex-none text-[11.5px]', SIGNAL_MUTED)}
          >
            {bucket.label}
          </span>
          <span className="h-[9px] flex-1 overflow-hidden rounded-[3px] bg-black/[.06] dark:bg-white/[.07]">
            <span
              className="block h-full rounded-[3px]"
              style={{
                width: `${bucket.count === 0 ? 0 : Math.max((bucket.count / max) * 100, 3)}%`,
                background: color,
              }}
            />
          </span>
          <span className="w-[64px] flex-none text-right text-[11.5px] font-semibold tabular-nums">
            {bucket.count}
            <span className={cn('ml-1 font-normal', SIGNAL_FAINT)}>
              {total > 0 ? `${Math.round((bucket.count / total) * 100)}%` : ''}
            </span>
          </span>
        </div>
      ))}
      <p className={cn('text-[11px]', SIGNAL_FAINT)}>{unit}</p>
    </div>
  );
}

/** "No X" line, so an empty section still says what it looked for. */
function Empty({ children }: { children: React.ReactNode }) {
  return <p className={cn('text-[13px]', SIGNAL_MUTED)}>{children}</p>;
}

export default function ProjectManagementExecutiveDashboardPage() {
  const [data, setData] = useState<ProjectManagementDashboard | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [pmFilter, setPmFilter] = useState('');

  const load = useCallback(() => {
    setLoading(true);
    fetchProjectManagementDashboard()
      .then((result) => {
        setData(result);
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

  /** The filter is by PM id, so two PMs sharing a display name never merge. */
  const matches = useCallback(
    (pmId: string | null | undefined) => !pmFilter || pmId === pmFilter,
    [pmFilter],
  );
  const filtered = pmFilter.length > 0;

  const projects = useMemo(
    () => (data?.projects ?? []).filter((project) => matches(project.pmId)),
    [data, matches],
  );

  /** Health split recomputed from the complete project list, so it obeys the filter. */
  const healthCounts = useMemo(() => {
    const count = (health: ProjectHealth) =>
      projects.filter((project) => project.health === health).length;
    return {
      ON_TRACK: count('ON_TRACK'),
      AT_RISK: count('AT_RISK'),
      BLOCKED: count('BLOCKED'),
      total: projects.length,
    };
  }, [projects]);

  /** Delivery rollup off the shared urgency scale — one tier per project row. */
  const deliveryRows = useMemo(
    () => (data?.delivery.rows ?? []).filter((row) => matches(row.pmId)),
    [data, matches],
  );
  const deliveryByTier = useMemo(() => {
    const counts = new Map<DeliveryUrgencyTier, number>();
    for (const row of deliveryRows) {
      const tier = deliveryUrgencyTier(row.daysUntilDue);
      counts.set(tier, (counts.get(tier) ?? 0) + 1);
    }
    return counts;
  }, [deliveryRows]);

  const workloadRows = useMemo(
    () => (data?.workload.rows ?? []).filter((row) => matches(row.pmId)),
    [data, matches],
  );

  const overdueDeliveries = deliveryByTier.get('OVERDUE') ?? 0;
  const troubledPercent =
    healthCounts.total > 0
      ? ((healthCounts.BLOCKED + healthCounts.AT_RISK) / healthCounts.total) *
        100
      : null;

  if (!data) {
    return (
      <ExecutiveShell
        active="project-management"
        title="Project Management Dashboard"
        description="PM-attributed project health, blockers, delivery and workload"
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
        <Empty>{loading ? 'Loading…' : 'No dashboard data available.'}</Empty>
      </ExecutiveShell>
    );
  }

  const {
    portfolio,
    blockers,
    workload,
    awaitingKickoff,
    ordersAwaitingDelivery,
    milestones,
    actionItems,
    risks,
    pings,
  } = data;

  return (
    <ExecutiveShell
      active="project-management"
      fixedHeader
      title="Project Management Dashboard"
      chip={
        <SignalChip>
          {portfolio.activeTotal} active{' '}
          {portfolio.activeTotal === 1 ? 'project' : 'projects'} ·{' '}
          {portfolio.pmCount} {portfolio.pmCount === 1 ? 'PM' : 'PMs'}
        </SignalChip>
      }
      description={`PM-attributed delivery visibility · as of ${dateTime(data.asOf)} · ${portfolio.totalEverStarted} kickoff(s) ever started`}
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
      // ══ Who to look at, and the one project to look at first ═══════════
      toolbar={
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <span className={cn('text-[12px] font-semibold', SIGNAL_MUTED)}>
              Project manager
            </span>
            <select
              value={pmFilter}
              onChange={(event) => setPmFilter(event.target.value)}
              className="min-w-64 rounded-lg border border-black/15 bg-white px-3 py-2 text-[12px] dark:border-white/[.16] dark:bg-[#232323]"
            >
              <option value="">All project managers</option>
              {workload.rows.map((row) => (
                <option key={row.pmId} value={row.pmId}>
                  {row.pm} — {row.activeProjects} project(s), {row.openTasks}{' '}
                  task(s)
                </option>
              ))}
            </select>
            {filtered && (
              <button
                type="button"
                onClick={() => setPmFilter('')}
                className={cn(SIGNAL_BTN_GHOST, 'text-[11.5px]')}
              >
                Clear filter
              </button>
            )}
            <span className={cn('ml-auto text-[11.5px]', SIGNAL_FAINT)}>
              {projects.length} project(s) in this view
            </span>
          </div>
          <nav
            className="flex gap-1 overflow-x-auto"
            aria-label="Dashboard sections"
          >
            {[
              ['#portfolio', 'Overview'],
              ['#projects', 'Projects'],
              ['#blockers', `Blockers (${blockers.total})`],
              ['#delivery', `Delivery (${overdueDeliveries} overdue)`],
              ['#workload', 'Workload'],
              ['#execution', 'Milestones & actions'],
              [
                '#risks',
                `Risks & pings (${risks.highImpactOpen + pings.unacknowledged})`,
              ],
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
        </div>
      }
    >
      {error && <Callout variant="danger">{error}</Callout>}

      {portfolio.worst && !filtered && (
        <Callout variant="danger">
          <span className="font-semibold">{portfolio.worst.projectName}</span> —{' '}
          {portfolio.worst.healthReason}. PM {portfolio.worst.pm} ·{' '}
          {deliveryCountdownLabel(portfolio.worst.daysUntilDue)}.
        </Callout>
      )}

      <div id="portfolio" className="scroll-mt-[var(--exec-chrome-height)]">
        <StatStrip>
          <StatTile
            label="Blocked projects"
            value={healthCounts.BLOCKED}
            valueClass={healthCounts.BLOCKED > 0 ? DANGER_TEXT : undefined}
            hint={
              healthCounts.BLOCKED === 0
                ? `nothing blocked across ${healthCounts.total} active project(s)`
                : `of ${healthCounts.total} active · ${blockers.total} blocker(s) to clear`
            }
          />
          <StatTile
            label="At-risk projects"
            value={healthCounts.AT_RISK}
            valueClass={healthCounts.AT_RISK > 0 ? WARNING_TEXT : undefined}
            hint={`${milestones.overdue} overdue milestone(s) · ${actionItems.overdue} overdue action(s)`}
          />
          <StatTile
            label="Overdue deliveries"
            value={overdueDeliveries}
            valueClass={overdueDeliveries > 0 ? DANGER_TEXT : undefined}
            hint={
              data.delivery.measured === 0
                ? 'no project has a promised date to measure against'
                : `of ${deliveryRows.length - (deliveryByTier.get('UNCONFIRMED') ?? 0)} with a promised date · avg overrun ${number(data.delivery.averageOverrunDays)} day(s)`
            }
          />
          <StatTile
            label="Awaiting kickoff"
            value={awaitingKickoff.total}
            valueClass={awaitingKickoff.total > 0 ? WARNING_TEXT : undefined}
            hint={
              awaitingKickoff.total === 0
                ? 'every qualifying order has a kickoff'
                : `oldest waiting ${awaitingKickoff.rows[0]?.waitingDays ?? 0} day(s) · ${awaitingKickoff.alreadyOverdue} already past its promised date`
            }
          />
        </StatStrip>
      </div>

      {/* ══ §1 Portfolio shape: health, stage, age ════════════════════════ */}
      <div className="grid scroll-mt-[var(--exec-chrome-height)] gap-4 xl:grid-cols-2">
        <SCard className="p-5">
          <SCardTitle
            title="Project health"
            subtitle={
              filtered
                ? 'Recomputed for the selected PM from the same health badges'
                : 'From the shared project-progress builder, not recounted here'
            }
          />
          <div className="mt-4 flex items-center gap-5">
            <Donut
              slices={(
                ['BLOCKED', 'AT_RISK', 'ON_TRACK'] as ProjectHealth[]
              ).map((health) => ({
                label: titleCase(health),
                value: healthCounts[health],
                color: HEALTH_COLOR[health],
                percentLabel:
                  healthCounts.total > 0
                    ? `${Math.round((healthCounts[health] / healthCounts.total) * 100)}%`
                    : null,
              }))}
              centerValue={String(healthCounts.total)}
              centerLabel="active projects"
            />
            <div className="min-w-0 flex-1 space-y-2">
              {(['BLOCKED', 'AT_RISK', 'ON_TRACK'] as ProjectHealth[]).map(
                (health) => (
                  <LegendRow
                    key={health}
                    color={HEALTH_COLOR[health]}
                    label={titleCase(health)}
                    value={String(healthCounts[health])}
                    percentLabel={
                      healthCounts.total > 0
                        ? `${Math.round((healthCounts[health] / healthCounts.total) * 100)}%`
                        : null
                    }
                  />
                ),
              )}
              <div className={cn('pt-1 text-[11.5px]', SIGNAL_FAINT)}>
                {filtered ? 'Portfolio-wide' : 'Needing intervention'}:{' '}
                <span className="font-semibold tabular-nums">
                  {troubledPercent === null
                    ? '—'
                    : `${troubledPercent.toFixed(1)}%`}
                </span>{' '}
                · average project age{' '}
                <span className="font-semibold tabular-nums">
                  {number(portfolio.averageAgeDays)}
                </span>{' '}
                day(s)
              </div>
              {portfolio.note && (
                <p className={cn('text-[11.5px]', SIGNAL_MUTED)}>
                  {portfolio.note}
                </p>
              )}
            </div>
          </div>
        </SCard>

        <SCard className="p-5">
          <SCardTitle
            title="Where the portfolio sits"
            subtitle="Current stage on the shared seven-stage ladder"
            right={
              <span className={cn('text-[11px]', SIGNAL_FAINT)}>
                bars show project count
              </span>
            }
          />
          <div className="mt-4">
            {portfolio.stages.length === 0 ? (
              <Empty>No project is in flight, so no stage carries any.</Empty>
            ) : (
              <FunnelBars
                stages={portfolio.stages.map((stage) => ({
                  key: stage.key,
                  label: stage.label,
                  count: stage.count,
                  valueLabel: percent(stage.percentOfActive),
                  note:
                    stage.blocked + stage.atRisk > 0
                      ? `${stage.blocked} blocked · ${stage.atRisk} at risk`
                      : null,
                  color:
                    stage.blocked > 0
                      ? CHART_COLORS.red
                      : stage.atRisk > 0
                        ? CHART_COLORS.orange
                        : CHART_COLORS.blue,
                }))}
              />
            )}
          </div>
        </SCard>
      </div>

      {/* ══ §1 The named list: every project, its PM, its health ═════════ */}
      <div id="projects" className="scroll-mt-[var(--exec-chrome-height)]">
        <SCard className="p-5">
          <SCardTitle
            title="Project status"
            subtitle="Worst first — every project named with the PM who owns it"
            right={
              <span className={cn('text-[11px]', SIGNAL_FAINT)}>
                {projects.length} of {portfolio.activeTotal} shown
              </span>
            }
          />
          <div className="mt-3 grid gap-x-6 md:grid-cols-2">
            {projects.length === 0 ? (
              <Empty>
                {portfolio.note ??
                  'No active project for the selected project manager.'}
              </Empty>
            ) : (
              projects.map((project) => (
                <Row key={project.kickoffId}>
                  <div className="flex flex-wrap items-center gap-2">
                    <Link
                      href={`/project-kickoff/${project.kickoffId}`}
                      className={cn('text-[13px] font-semibold', SIGNAL_LINK)}
                    >
                      {project.projectName}
                    </Link>
                    <ToneChip tone={HEALTH_TONE[project.health]}>
                      {titleCase(project.health)}
                    </ToneChip>
                    <span
                      className={cn(
                        'ml-auto text-[11.5px] font-semibold tabular-nums',
                        DELIVERY_URGENCY_TEXT_CLASS[
                          deliveryUrgencyTier(project.daysUntilDue)
                        ],
                      )}
                    >
                      {deliveryCountdownLabel(project.daysUntilDue)}
                    </span>
                  </div>
                  <div className={cn('mt-1 text-[12px]', SIGNAL_MUTED)}>
                    PM <span className="font-semibold">{project.pm}</span> ·{' '}
                    {project.orderNumber} · {titleCase(project.currentStage)} ·{' '}
                    {project.ageDays} day(s) old
                  </div>
                  <div className={cn('mt-1 text-[12px]')}>
                    {project.healthReason}
                  </div>
                  {/* The lamp strip: the shared stage ladder, unmodified. */}
                  <div className="mt-2 flex gap-1">
                    {project.stages.map((stage) => (
                      <span
                        key={stage.key}
                        title={`${stage.label}: ${stage.detail || titleCase(stage.state)}`}
                        className="h-[5px] flex-1 rounded-full"
                        style={{
                          background:
                            stage.state === 'COMPLETE'
                              ? CHART_COLORS.green
                              : stage.state === 'IN_PROGRESS'
                                ? CHART_COLORS.blue
                                : stage.state === 'ATTENTION'
                                  ? CHART_COLORS.red
                                  : 'var(--sd-track)',
                        }}
                      />
                    ))}
                  </div>
                  {(project.overdueMilestones > 0 ||
                    project.overdueActionItems > 0 ||
                    project.openHighRisks > 0 ||
                    project.overdueTasks > 0) && (
                    <div className={cn('mt-1.5 text-[11.5px]', WARNING_TEXT)}>
                      {[
                        project.overdueMilestones > 0 &&
                          `${project.overdueMilestones} overdue milestone(s)`,
                        project.overdueActionItems > 0 &&
                          `${project.overdueActionItems} overdue action(s)`,
                        project.openHighRisks > 0 &&
                          `${project.openHighRisks} severe risk(s)`,
                        project.overdueTasks > 0 &&
                          `${project.overdueTasks} overdue task(s)`,
                      ]
                        .filter(Boolean)
                        .join(' · ')}
                    </div>
                  )}
                  {project.nextMilestone && (
                    <div className={cn('mt-1 text-[11.5px]', SIGNAL_FAINT)}>
                      Next: {project.nextMilestone.name} ·{' '}
                      {project.nextMilestone.owner} ·{' '}
                      {date(project.nextMilestone.targetDate)}
                    </div>
                  )}
                </Row>
              ))
            )}
          </div>
        </SCard>
      </div>

      {/* ══ §2 Actionable blockers — who to call ══════════════════════════ */}
      <div
        id="blockers"
        className="grid scroll-mt-[var(--exec-chrome-height)] gap-4 xl:grid-cols-[minmax(0,7fr)_minmax(0,5fr)]"
      >
        <SCard className="p-5">
          <SCardTitle
            title="Actionable blockers"
            subtitle="Project · the specific blocker · who owns clearing it"
            right={
              <ToneChip tone={blockers.total > 0 ? 'danger' : 'success'}>
                {blockers.total} across {blockers.projectsAffected} project(s)
              </ToneChip>
            }
          />
          <div className="mt-3">
            {blockers.entries.filter((entry) => matches(entry.pmId)).length ===
            0 ? (
              <Empty>
                {blockers.note ??
                  'No blocker for the selected project manager.'}
              </Empty>
            ) : (
              blockers.entries
                .filter((entry) => matches(entry.pmId))
                .map((entry, index) => (
                  <Row key={`${entry.kickoffId}-${entry.kind}-${index}`}>
                    <div className="flex gap-2">
                      {entry.severity === 'BLOCKED' ? (
                        <ShieldAlert
                          className={cn(
                            'mt-0.5 size-3.5 flex-none',
                            DANGER_TEXT,
                          )}
                        />
                      ) : (
                        <AlertTriangle
                          className={cn(
                            'mt-0.5 size-3.5 flex-none',
                            WARNING_TEXT,
                          )}
                        />
                      )}
                      <div className="min-w-0 flex-1">
                        <div className="text-[13px] font-semibold">
                          {entry.blocker}
                        </div>
                        <div
                          className={cn(
                            'mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px]',
                            SIGNAL_MUTED,
                          )}
                        >
                          <Link
                            href={`/project-kickoff/${entry.kickoffId}`}
                            className={SIGNAL_LINK}
                          >
                            {entry.project}
                          </Link>
                          <span>· PM {entry.pm}</span>
                          <span>
                            · owner{' '}
                            <span
                              className={cn(
                                'font-semibold',
                                entry.owner === 'Unassigned' && DANGER_TEXT,
                              )}
                            >
                              {entry.owner}
                            </span>
                          </span>
                          {entry.overdueDays !== null && (
                            <span className={DANGER_TEXT}>
                              · {entry.overdueDays} day(s) late
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  </Row>
                ))
            )}
          </div>
        </SCard>

        <SCard className="p-5">
          <SCardTitle
            title="Who to call"
            subtitle="Blockers ranked by the person who owns them"
          />
          <div className="mt-4">
            {blockers.total === 0 ? (
              <Empty>{blockers.note}</Empty>
            ) : (
              <>
                <SplitBar
                  segments={blockers.byKind
                    .filter((kind) => kind.count > 0)
                    .map((kind, index) => ({
                      label: kind.label,
                      value: kind.count,
                      color: [
                        CHART_COLORS.red,
                        CHART_COLORS.orange,
                        CHART_COLORS.blue,
                        CHART_COLORS.purple,
                      ][index % 4],
                    }))}
                />
                <div className="mt-4">
                  {blockers.owners.map((owner) => (
                    <Row
                      key={owner.owner}
                      className="flex items-center justify-between gap-3"
                    >
                      <span
                        className={cn(
                          'truncate text-[13px] font-semibold',
                          owner.owner === 'Unassigned' && DANGER_TEXT,
                        )}
                      >
                        {owner.owner}
                      </span>
                      <span
                        className={cn(
                          'flex-none text-[12px] tabular-nums',
                          SIGNAL_MUTED,
                        )}
                      >
                        {owner.count} blocker(s) · {owner.projectCount}{' '}
                        project(s) · {percent(owner.sharePercent)}
                      </span>
                    </Row>
                  ))}
                  {blockers.unassigned > 0 && (
                    <p className={cn('pt-2 text-[11.5px]', DANGER_TEXT)}>
                      {blockers.unassigned} blocker(s) have no owner at all —
                      nobody is currently accountable for clearing them.
                    </p>
                  )}
                </div>
              </>
            )}
          </div>
        </SCard>
      </div>

      {/* ══ §3 Delivery date progress, per PM ════════════════════════════ */}
      <div id="delivery" className="scroll-mt-[var(--exec-chrome-height)]">
        <SCard className="p-5">
          <SCardTitle
            title="Delivery date progress"
            subtitle="Same promised-date urgency scale the PLM rows use, grouped by PM"
            right={
              <span className={cn('text-[11px]', SIGNAL_FAINT)}>
                {data.delivery.unconfirmed} project(s) have no promised date
              </span>
            }
          />
          <div className="mt-4 grid gap-5 lg:grid-cols-[minmax(0,4fr)_minmax(0,6fr)]">
            <div>
              <SplitBar
                segments={DELIVERY_TIERS.filter(
                  (tier) => (deliveryByTier.get(tier.tier) ?? 0) > 0,
                ).map((tier) => ({
                  label: tier.label,
                  value: deliveryByTier.get(tier.tier) ?? 0,
                  color: tier.color,
                }))}
              />
              <div className="mt-4 space-y-2">
                {DELIVERY_TIERS.map((tier) => (
                  <LegendRow
                    key={tier.tier}
                    color={tier.color}
                    label={tier.label}
                    value={String(deliveryByTier.get(tier.tier) ?? 0)}
                    percentLabel={
                      deliveryRows.length > 0
                        ? `${Math.round(((deliveryByTier.get(tier.tier) ?? 0) / deliveryRows.length) * 100)}%`
                        : null
                    }
                  />
                ))}
              </div>
              {data.delivery.note && (
                <p className={cn('mt-3 text-[11.5px]', SIGNAL_MUTED)}>
                  {data.delivery.note}
                </p>
              )}
            </div>
            <div>
              {deliveryRows.length === 0 ? (
                <Empty>
                  No active project for the selected project manager.
                </Empty>
              ) : (
                deliveryRows
                  .slice()
                  .sort(
                    (left, right) =>
                      (left.daysUntilDue ?? Number.POSITIVE_INFINITY) -
                      (right.daysUntilDue ?? Number.POSITIVE_INFINITY),
                  )
                  .map((row) => {
                    const tier = deliveryUrgencyTier(row.daysUntilDue);
                    return (
                      <Row
                        key={row.kickoffId}
                        className="flex items-start justify-between gap-3"
                      >
                        <div className="min-w-0">
                          <Link
                            href={`/project-kickoff/${row.kickoffId}`}
                            className={cn(
                              'text-[13px] font-semibold',
                              SIGNAL_LINK,
                            )}
                          >
                            {row.projectName}
                          </Link>
                          <div className={cn('mt-1 text-[12px]', SIGNAL_MUTED)}>
                            PM {row.pm} · {row.orderNumber} ·{' '}
                            {titleCase(row.currentStage)}
                          </div>
                        </div>
                        <div className="flex-none text-right">
                          <div
                            className={cn(
                              'text-[12px] font-semibold',
                              DELIVERY_URGENCY_TEXT_CLASS[tier],
                            )}
                          >
                            {deliveryCountdownLabel(row.daysUntilDue)}
                          </div>
                          <div className={cn('mt-1 text-[11px]', SIGNAL_FAINT)}>
                            {date(row.promisedDeliveryDate)} ·{' '}
                            {titleCase(row.fulfilmentStatus)}
                          </div>
                        </div>
                      </Row>
                    );
                  })
              )}
            </div>
          </div>
        </SCard>
      </div>

      {/* ══ §4 Team workload — the redistribution view ═══════════════════ */}
      <div id="workload" className="scroll-mt-[var(--exec-chrome-height)]">
        <SCard className="p-5">
          <SCardTitle
            title="Team workload"
            subtitle="Open board tasks and active projects each PM carries"
            right={
              <span className={cn('text-[11px]', SIGNAL_FAINT)}>
                bars are relative to the busiest PM
              </span>
            }
          />
          <div className="mt-4 grid gap-5 lg:grid-cols-[minmax(0,3fr)_minmax(0,7fr)]">
            <div className="flex items-center gap-4">
              <Gauge
                percent={
                  workload.taskImbalancePercent === null
                    ? null
                    : Number(workload.taskImbalancePercent)
                }
                label="Imbalance"
                color={
                  Number(workload.taskImbalancePercent ?? 0) >= 50
                    ? CHART_COLORS.red
                    : CHART_COLORS.orange
                }
              />
              <div className={cn('text-[11.5px]', SIGNAL_MUTED)}>
                <p>
                  0% is an even split across {workload.pmCount} PM(s); 100%
                  means one PM carries every open task.
                </p>
                <p className="mt-2">
                  {workload.totalOpenTasks} open task(s) · average{' '}
                  {number(workload.averageTasksPerPm)} per PM · busiest carries{' '}
                  {workload.peakOpenTasks}
                </p>
                <p className="mt-2">
                  Projects per PM: average{' '}
                  {number(workload.averageProjectsPerPm)} · imbalance{' '}
                  {percent(workload.projectImbalancePercent)}
                </p>
                {workload.note && <p className="mt-2">{workload.note}</p>}
              </div>
            </div>
            <div>
              {workloadRows.length === 0 ? (
                <Empty>
                  No project manager currently carries an active project.
                </Empty>
              ) : (
                workloadRows.map((row) => (
                  <Row key={row.pmId}>
                    <div className="flex flex-wrap items-baseline gap-x-2">
                      <span className="text-[13px] font-semibold">
                        {row.pm}
                      </span>
                      <span className="text-[15px] font-extrabold tabular-nums tracking-[-.4px]">
                        {row.openTasks}
                      </span>
                      <span className={cn('text-[11.5px]', SIGNAL_MUTED)}>
                        open task(s) across {row.activeProjects} project(s) ·{' '}
                        {number(row.tasksPerProject)} per project
                      </span>
                      {row.overdueTasks > 0 && (
                        <span
                          className={cn(
                            'ml-auto text-[11.5px] font-semibold',
                            DANGER_TEXT,
                          )}
                        >
                          {row.overdueTasks} overdue
                        </span>
                      )}
                    </div>
                    <div className="mt-1.5 h-[9px] overflow-hidden rounded-[3px] bg-black/[.06] dark:bg-white/[.07]">
                      <div
                        className="h-full rounded-[3px]"
                        style={{
                          width: `${row.loadPercent === null ? 0 : Math.max(Number(row.loadPercent), row.openTasks > 0 ? 2 : 0)}%`,
                          background:
                            row.blockedProjects > 0
                              ? CHART_COLORS.red
                              : row.atRiskProjects > 0
                                ? CHART_COLORS.orange
                                : CHART_COLORS.blue,
                        }}
                      />
                    </div>
                    <div className="mt-2">
                      <SplitBar
                        segments={[
                          {
                            label: `${row.blockedProjects} blocked`,
                            value: row.blockedProjects,
                            color: CHART_COLORS.red,
                          },
                          {
                            label: `${row.atRiskProjects} at risk`,
                            value: row.atRiskProjects,
                            color: CHART_COLORS.orange,
                          },
                          {
                            label: `${row.onTrackProjects} on track`,
                            value: row.onTrackProjects,
                            color: CHART_COLORS.green,
                          },
                        ]}
                      />
                    </div>
                    <div className={cn('mt-2 text-[11.5px]', SIGNAL_MUTED)}>
                      {row.overdueMilestones} overdue milestone(s) ·{' '}
                      {row.overdueActionItems} overdue action(s) ·{' '}
                      {row.openHighRisks} open severe risk(s) ·{' '}
                      {row.overdueDeliveries} overdue delivery(ies)
                      {row.unassignedTasks > 0 && (
                        <> · {row.unassignedTasks} task(s) with no assignee</>
                      )}
                    </div>
                  </Row>
                ))
              )}
            </div>
          </div>
        </SCard>
      </div>

      {/* ══ §5 Projects awaiting kickoff · §6 Orders awaiting delivery ═══ */}
      <div className="grid gap-4 xl:grid-cols-2">
        <SCard className="p-5">
          <SCardTitle
            title="Projects awaiting kickoff"
            subtitle="Executed OCS or confirmed internal order, no kickoff created"
            right={
              <ToneChip
                tone={awaitingKickoff.total > 0 ? 'warning' : 'success'}
              >
                {awaitingKickoff.total} waiting
              </ToneChip>
            }
          />
          <div className="mt-4">
            {awaitingKickoff.total === 0 ? (
              <Empty>{awaitingKickoff.note}</Empty>
            ) : (
              <>
                <BucketBars
                  buckets={awaitingKickoff.ageBuckets}
                  color={CHART_COLORS.orange}
                  unit={`Waiting since the order qualified · average ${number(awaitingKickoff.averageWaitingDays)} day(s)`}
                />
                <div className="mt-4">
                  {awaitingKickoff.rows.map((row) => (
                    <Row
                      key={row.id}
                      className="flex items-start justify-between gap-3"
                    >
                      <div className="min-w-0">
                        <Link
                          href={`/sales/orders/${row.id}`}
                          className={cn(
                            'text-[13px] font-semibold',
                            SIGNAL_LINK,
                          )}
                        >
                          {row.orderNumber}
                        </Link>
                        <div className={cn('mt-1 text-[12px]', SIGNAL_MUTED)}>
                          {row.source === 'INTERNAL_CONFIRMED'
                            ? 'Confirmed internal order'
                            : 'Executed OCS'}{' '}
                          · {row.lineCount} line(s) · qualified{' '}
                          {date(row.qualifiedAt)}
                        </div>
                      </div>
                      <div className="flex-none text-right">
                        <div
                          className={cn(
                            'text-[12px] font-semibold tabular-nums',
                            row.waitingDays > 7 ? WARNING_TEXT : SIGNAL_MUTED,
                          )}
                        >
                          {row.waitingDays} day(s) waiting
                        </div>
                        <div
                          className={cn(
                            'mt-1 text-[11px]',
                            row.daysUntilDue !== null && row.daysUntilDue < 0
                              ? DANGER_TEXT
                              : SIGNAL_FAINT,
                          )}
                        >
                          {deliveryCountdownLabel(row.daysUntilDue)}
                        </div>
                      </div>
                    </Row>
                  ))}
                </div>
                {awaitingKickoff.alreadyOverdue > 0 && (
                  <p className={cn('mt-3 text-[11.5px]', DANGER_TEXT)}>
                    {awaitingKickoff.alreadyOverdue} of these are already past a
                    promised delivery date with no work scheduled at all.
                  </p>
                )}
              </>
            )}
          </div>
        </SCard>

        <SCard className="p-5">
          <SCardTitle
            title="Orders awaiting delivery"
            subtitle="Project orders where not every line has been dispatched"
            right={
              <ToneChip
                tone={ordersAwaitingDelivery.total > 0 ? 'info' : 'success'}
              >
                {ordersAwaitingDelivery.total} order(s) ·{' '}
                {ordersAwaitingDelivery.lineCount} line(s)
              </ToneChip>
            }
          />
          <div className="mt-4">
            {ordersAwaitingDelivery.total === 0 ? (
              <Empty>{ordersAwaitingDelivery.note}</Empty>
            ) : (
              <>
                <SplitBar
                  segments={ordersAwaitingDelivery.byStatus.map(
                    (status, index) => ({
                      label: `${status.label} (${status.count})`,
                      value: status.count,
                      color: [
                        CHART_COLORS.slate,
                        CHART_COLORS.blue,
                        CHART_COLORS.teal,
                      ][index % 3],
                    }),
                  )}
                />
                <div className="mt-4">
                  {ordersAwaitingDelivery.rows
                    .filter((row) => matches(row.pmId))
                    .map((row) => (
                      <Row
                        key={row.orderId}
                        className="flex items-start justify-between gap-3"
                      >
                        <div className="min-w-0">
                          <Link
                            href={`/sales/orders/${row.orderId}`}
                            className={cn(
                              'text-[13px] font-semibold',
                              SIGNAL_LINK,
                            )}
                          >
                            {row.orderNumber}
                          </Link>
                          <div className={cn('mt-1 text-[12px]', SIGNAL_MUTED)}>
                            {row.projectName} · PM {row.pm} · {row.lineCount}{' '}
                            line(s)
                          </div>
                        </div>
                        <div className="flex-none text-right">
                          <div className={cn('text-[12px]', SIGNAL_MUTED)}>
                            {titleCase(row.fulfilmentStatus)}
                          </div>
                          <div
                            className={cn(
                              'mt-1 text-[11px]',
                              DELIVERY_URGENCY_TEXT_CLASS[
                                deliveryUrgencyTier(row.daysUntilDue)
                              ],
                            )}
                          >
                            {deliveryCountdownLabel(row.daysUntilDue)}
                          </div>
                        </div>
                      </Row>
                    ))}
                </div>
                <p className={cn('mt-3 text-[11.5px]', SIGNAL_FAINT)}>
                  {ordersAwaitingDelivery.note}
                </p>
              </>
            )}
          </div>
        </SCard>
      </div>

      {/* ══ §7 Milestone and action item health ══════════════════════════ */}
      <div
        id="execution"
        className="grid scroll-mt-[var(--exec-chrome-height)] gap-4 xl:grid-cols-2"
      >
        <SCard className="p-5">
          <SCardTitle
            title="Milestone health"
            subtitle="Overdue and flagged-delayed milestones, by project and PM"
            right={
              <ToneChip tone={milestones.overdue > 0 ? 'danger' : 'success'}>
                {milestones.overdue} overdue of {milestones.open} open
              </ToneChip>
            }
          />
          <div className="mt-4 flex items-center gap-4">
            <Gauge
              percent={
                milestones.completionPercent === null
                  ? null
                  : Number(milestones.completionPercent)
              }
              label="Completed"
              color={CHART_COLORS.green}
            />
            <div className={cn('text-[11.5px]', SIGNAL_MUTED)}>
              <p>
                {milestones.completed} of {milestones.total} milestone(s)
                complete · {percent(milestones.overdueOfOpenPercent)} of open
                milestones are late
              </p>
              <p className="mt-2">
                Average slip {number(milestones.averageSlipDays)} day(s) ·{' '}
                {milestones.flaggedDelayed} explicitly flagged delayed by a PM
              </p>
            </div>
          </div>
          {milestones.overdue > 0 && (
            <div className="mt-4">
              <div className={cn('mb-2', SIGNAL_EYEBROW)}>How far behind</div>
              <BucketBars
                buckets={milestones.slipBuckets}
                color={CHART_COLORS.red}
                unit="Days past the milestone's target date"
              />
            </div>
          )}
          <div className="mt-4">
            <div className={cn('mb-1', SIGNAL_EYEBROW)}>Overdue now</div>
            {milestones.rows.filter((row) => matches(row.pmId)).length === 0 ? (
              <Empty>
                {milestones.note ?? 'No overdue milestone for this selection.'}
              </Empty>
            ) : (
              milestones.rows
                .filter((row) => matches(row.pmId))
                .map((row) => (
                  <Row key={row.id}>
                    <div className="flex items-baseline gap-2">
                      <span className="min-w-0 flex-1 truncate text-[13px] font-semibold">
                        {row.name}
                      </span>
                      <span
                        className={cn(
                          'flex-none text-[12px] font-semibold tabular-nums',
                          DANGER_TEXT,
                        )}
                      >
                        {row.overdueDays} day(s) late
                      </span>
                    </div>
                    <div className={cn('mt-1 text-[12px]', SIGNAL_MUTED)}>
                      <Link
                        href={`/project-kickoff/${row.kickoffId}`}
                        className={SIGNAL_LINK}
                      >
                        {row.project}
                      </Link>{' '}
                      · PM {row.pm} · owner {row.owner} · target{' '}
                      {date(row.targetDate)}
                      {row.flaggedDelayed && (
                        <span
                          className={cn('ml-1 font-semibold', WARNING_TEXT)}
                        >
                          · flagged delayed
                        </span>
                      )}
                    </div>
                  </Row>
                ))
            )}
          </div>
          {milestones.upcoming.length > 0 && (
            <div className="mt-4">
              <div className={cn('mb-1', SIGNAL_EYEBROW)}>Landing next</div>
              {milestones.upcoming
                .filter((row) => matches(row.pmId))
                .map((row) => (
                  <Row
                    key={row.id}
                    className="flex items-baseline justify-between gap-3"
                  >
                    <span className="min-w-0 truncate text-[12.5px]">
                      <span className="font-semibold">{row.name}</span>{' '}
                      <span className={SIGNAL_MUTED}>
                        — {row.project} · {row.owner}
                      </span>
                    </span>
                    <span
                      className={cn(
                        'flex-none text-[11.5px] tabular-nums',
                        row.daysUntilDue <= 7 ? WARNING_TEXT : SIGNAL_MUTED,
                      )}
                    >
                      in {row.daysUntilDue} day(s)
                    </span>
                  </Row>
                ))}
            </div>
          )}
        </SCard>

        <SCard className="p-5">
          <SCardTitle
            title="Action item health"
            subtitle="Status derived from each item's linked board card"
            right={
              <ToneChip tone={actionItems.overdue > 0 ? 'danger' : 'success'}>
                {actionItems.overdue} overdue of {actionItems.open} open
              </ToneChip>
            }
          />
          <div className="mt-4 flex items-center gap-5">
            <Donut
              slices={actionItems.byStatus.map((status) => ({
                label: status.label,
                value: status.count,
                color: ACTION_STATUS_COLOR[status.status] ?? CHART_COLORS.slate,
                percentLabel:
                  actionItems.total > 0
                    ? `${Math.round((status.count / actionItems.total) * 100)}%`
                    : null,
              }))}
              centerValue={String(actionItems.total)}
              centerLabel="action items"
            />
            <div className="min-w-0 flex-1 space-y-2">
              {actionItems.byStatus.map((status) => (
                <LegendRow
                  key={status.status}
                  color={
                    ACTION_STATUS_COLOR[status.status] ?? CHART_COLORS.slate
                  }
                  label={status.label}
                  value={String(status.count)}
                  percentLabel={
                    actionItems.total > 0
                      ? `${Math.round((status.count / actionItems.total) * 100)}%`
                      : null
                  }
                />
              ))}
            </div>
          </div>
          <div className={cn('mt-3 text-[11.5px]', SIGNAL_MUTED)}>
            {percent(actionItems.overdueOfOpenPercent)} of open items are late ·
            average slip {number(actionItems.averageSlipDays)} day(s) ·{' '}
            {actionItems.undated} open item(s) carry no due date
            {actionItems.withoutLiveStatus > 0 && (
              <>
                {' '}
                · {actionItems.withoutLiveStatus} item(s) have no live card and
                so no status to act on
              </>
            )}
          </div>
          <div className="mt-4">
            <div className={cn('mb-1', SIGNAL_EYEBROW)}>Overdue now</div>
            {actionItems.rows.filter((row) => matches(row.pmId)).length ===
            0 ? (
              <Empty>
                {actionItems.overdue === 0
                  ? 'No open action item is past its due date.'
                  : 'No overdue action item for the selected project manager.'}
              </Empty>
            ) : (
              actionItems.rows
                .filter((row) => matches(row.pmId))
                .map((row) => (
                  <Row key={row.id}>
                    <div className="flex items-baseline gap-2">
                      <span className="min-w-0 flex-1 text-[13px] font-semibold">
                        {row.description}
                      </span>
                      <span
                        className={cn(
                          'flex-none text-[12px] font-semibold tabular-nums',
                          DANGER_TEXT,
                        )}
                      >
                        {row.overdueDays === null
                          ? '—'
                          : `${row.overdueDays} day(s) late`}
                      </span>
                    </div>
                    <div className={cn('mt-1 text-[12px]', SIGNAL_MUTED)}>
                      <Link
                        href={`/project-kickoff/${row.kickoffId}`}
                        className={SIGNAL_LINK}
                      >
                        {row.project}
                      </Link>{' '}
                      · PM {row.pm} · owner {row.owner} · due{' '}
                      {date(row.dueDate)} · {titleCase(row.status)}
                    </div>
                  </Row>
                ))
            )}
          </div>
          <p className={cn('mt-3 text-[11px]', SIGNAL_FAINT)}>
            {actionItems.note}
          </p>
        </SCard>
      </div>

      {/* ══ §8 Open high-impact risks · §9 Project-linked pings ══════════ */}
      <div
        id="risks"
        className="grid scroll-mt-[var(--exec-chrome-height)] gap-4 xl:grid-cols-2"
      >
        <SCard className="p-5">
          <SCardTitle
            title="Open high-impact risks"
            subtitle="HIGH on either axis of the likelihood/impact matrix"
            right={
              <ToneChip tone={risks.highImpactOpen > 0 ? 'danger' : 'success'}>
                {risks.highImpactOpen} severe · {risks.projectsAffected}{' '}
                project(s)
              </ToneChip>
            }
          />
          <div className="mt-4">
            {risks.open === 0 ? (
              <Empty>{risks.note}</Empty>
            ) : (
              <>
                {/* Likelihood × impact heatmap of every open risk. */}
                <div className="inline-grid grid-cols-[auto_repeat(3,minmax(52px,1fr))] gap-px overflow-hidden rounded-lg border border-black/10 bg-black/10 dark:border-white/[.08] dark:bg-white/[.08]">
                  <div className="bg-white px-2 py-1.5 dark:bg-[#232323]" />
                  {MATRIX_LEVELS.map((likelihood) => (
                    <div
                      key={`head-${likelihood}`}
                      className={cn(
                        'bg-white px-2 py-1.5 text-center dark:bg-[#232323]',
                        SIGNAL_EYEBROW,
                      )}
                    >
                      {titleCase(likelihood)}
                    </div>
                  ))}
                  {MATRIX_LEVELS.map((impact) => (
                    <div key={impact} className="contents">
                      <div
                        className={cn(
                          'bg-white px-2 py-1.5 dark:bg-[#232323]',
                          SIGNAL_EYEBROW,
                        )}
                      >
                        {titleCase(impact)} impact
                      </div>
                      {MATRIX_LEVELS.map((likelihood) => {
                        const cell = risks.matrix.find(
                          (entry) =>
                            entry.impact === impact &&
                            entry.likelihood === likelihood,
                        );
                        const severe =
                          impact === 'HIGH' || likelihood === 'HIGH';
                        return (
                          <div
                            key={`${impact}-${likelihood}`}
                            className={cn(
                              'bg-white px-2 py-1.5 text-center text-[14px] font-bold tabular-nums dark:bg-[#232323]',
                              (cell?.count ?? 0) === 0
                                ? SIGNAL_FAINT
                                : severe
                                  ? DANGER_TEXT
                                  : WARNING_TEXT,
                            )}
                          >
                            {cell?.count ?? 0}
                          </div>
                        );
                      })}
                    </div>
                  ))}
                </div>
                <p className={cn('mt-2 text-[11px]', SIGNAL_FAINT)}>
                  Columns are likelihood · {risks.open} open risk(s) of{' '}
                  {risks.total} on the register ·{' '}
                  <span
                    className={risks.unmitigated > 0 ? DANGER_TEXT : undefined}
                  >
                    {risks.unmitigated} severe risk(s) with no mitigation plan (
                    {percent(risks.unmitigatedPercent)})
                  </span>
                </p>
                <div className="mt-4">
                  {risks.rows.filter((row) => matches(row.pmId)).length ===
                  0 ? (
                    <Empty>
                      No open severe risk for the selected project manager.
                    </Empty>
                  ) : (
                    risks.rows
                      .filter((row) => matches(row.pmId))
                      .map((row) => (
                        <Row key={row.id}>
                          <div className="flex items-baseline gap-2">
                            <Flag
                              className={cn(
                                'mt-0.5 size-3.5 flex-none',
                                row.hasMitigation ? WARNING_TEXT : DANGER_TEXT,
                              )}
                            />
                            <span className="min-w-0 flex-1 text-[13px] font-semibold">
                              {row.description}
                            </span>
                            <ToneChip
                              tone={row.hasMitigation ? 'warning' : 'danger'}
                            >
                              {titleCase(row.impact)} impact ·{' '}
                              {titleCase(row.likelihood)} likelihood
                            </ToneChip>
                          </div>
                          <div className={cn('mt-1 text-[12px]', SIGNAL_MUTED)}>
                            <Link
                              href={`/project-kickoff/${row.kickoffId}`}
                              className={SIGNAL_LINK}
                            >
                              {row.project}
                            </Link>{' '}
                            · PM {row.pm} · owner {row.owner} ·{' '}
                            {row.hasMitigation
                              ? 'mitigation plan recorded'
                              : 'no mitigation plan'}
                          </div>
                        </Row>
                      ))
                  )}
                </div>
              </>
            )}
          </div>
        </SCard>

        <SCard className="p-5">
          <SCardTitle
            title="Unresolved project pings"
            subtitle="Raised on a project's kickoff, order, tracker or board and still open"
            right={
              <ToneChip tone={pings.pastEscalation > 0 ? 'danger' : 'neutral'}>
                {pings.total} open · {pings.pastEscalation} past{' '}
                {AGING_AFTER_HOURS}h
              </ToneChip>
            }
          />
          <div className="mt-4">
            {pings.total === 0 ? (
              <Empty>{pings.note}</Empty>
            ) : (
              <>
                <div className="flex items-center gap-4">
                  <Gauge
                    percent={
                      pings.escalationRatePercent === null
                        ? null
                        : Number(pings.escalationRatePercent)
                    }
                    label={`Past ${AGING_AFTER_HOURS}h`}
                    color={CHART_COLORS.red}
                  />
                  <div className={cn('text-[11.5px]', SIGNAL_MUTED)}>
                    <p>
                      {pings.unacknowledged} of {pings.total} have not even been
                      acknowledged · {pings.projectsAffected} project(s)
                      affected
                    </p>
                    <p className="mt-2">
                      Average age {number(pings.averageAgeHours)}h · oldest{' '}
                      {number(pings.oldestAgeHours)}h
                    </p>
                    <p className="mt-2">
                      {pings.byLinkedRecord
                        .map((entry) => `${entry.label}: ${entry.count}`)
                        .join(' · ')}
                    </p>
                  </div>
                </div>
                <div className="mt-4">
                  {pings.rows.filter((row) => matches(row.pmId)).length ===
                  0 ? (
                    <Empty>
                      No unresolved ping for the selected project manager.
                    </Empty>
                  ) : (
                    pings.rows
                      .filter((row) => matches(row.pmId))
                      .map((row) => {
                        const href = linkedPingHref(
                          row.linkedRecordType,
                          row.linkedRecordId,
                        );
                        const tier = urgencyTier(row.ageHours);
                        return (
                          <Row key={row.id}>
                            <div className="flex items-baseline gap-2">
                              <span className="min-w-0 flex-1 text-[13px]">
                                {row.message}
                              </span>
                              <span
                                className={cn(
                                  'flex-none text-[11.5px] font-semibold tabular-nums',
                                  tier === 'stale'
                                    ? DANGER_TEXT
                                    : tier === 'aging'
                                      ? WARNING_TEXT
                                      : SUCCESS_TEXT,
                                )}
                              >
                                {row.ageHours}h old
                              </span>
                            </div>
                            <div
                              className={cn('mt-1 text-[12px]', SIGNAL_MUTED)}
                            >
                              {href ? (
                                <Link href={href} className={SIGNAL_LINK}>
                                  {row.project}
                                </Link>
                              ) : (
                                row.project
                              )}{' '}
                              · PM {row.pm} · from {row.from} · with{' '}
                              {row.owners.join(', ') || 'no recipient'}
                              {row.unacknowledged && (
                                <span
                                  className={cn(
                                    'ml-1 font-semibold',
                                    DANGER_TEXT,
                                  )}
                                >
                                  · unacknowledged
                                </span>
                              )}
                            </div>
                          </Row>
                        );
                      })
                  )}
                </div>
                <p className={cn('mt-3 text-[11px]', SIGNAL_FAINT)}>
                  {pings.note}
                </p>
              </>
            )}
          </div>
        </SCard>
      </div>

      {/* ══ Where every number comes from ═══════════════════════════════ */}
      <SCard className="p-5">
        <details>
          <summary className="cursor-pointer list-none">
            <SCardTitle
              title="How this dashboard is calculated"
              subtitle="Metric definitions and source rules"
              right={
                <span className={cn('text-[11px]', SIGNAL_FAINT)}>
                  Expand methodology
                </span>
              }
            />
          </summary>
          <ul className={cn('mt-3 space-y-1.5 text-[11.5px]', SIGNAL_MUTED)}>
            {data.basis.map((line) => (
              <li key={line} className="flex gap-2">
                <span className={SIGNAL_FAINT}>·</span>
                <span>{line}</span>
              </li>
            ))}
          </ul>
        </details>
      </SCard>
    </ExecutiveShell>
  );
}
