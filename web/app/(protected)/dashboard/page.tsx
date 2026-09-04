'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useAuth } from '../../lib/auth-context';
import { apiFetch } from '../../lib/api';
import { Employee } from '../../lib/types';
import {
  counterTrend,
  myCards,
  taskStats,
  type CounterTrend,
  type MyCard,
} from '../../lib/dashboard';
import {
  listProjectProgress,
  type ProjectProgress,
} from '../../lib/project-kickoff';
import { quoteOfTheDay } from '../../lib/quotes';
import { Spinner } from '../../components/ui/spinner';
import { cn } from '../../lib/utils';
import {
  getMyPlmWork,
  plmTrackerHref,
  type PlmDashboardItem,
} from '../../lib/plm';
import {
  getReceivedPings,
  getSentPings,
  isPingOverdue,
  linkedPingHref,
  orderReceivedForDashboard,
  pingAgeHours,
  respondToPing,
  type ReceivedPing,
  type SentPing,
} from '../../lib/pings';
import { usePendingApprovalCounts } from '../../lib/use-pending-approval-counts';
import {
  oldestPendingApproval,
  type OldestApproval,
} from '../../lib/approval-queues';
import { CheckinTimer } from './_components/checkin-timer';
import { PendingApprovalsMenu } from './_components/pending-approvals-menu';
import { ageHours } from '../../lib/urgency';
import {
  getMyEfficiencyScore,
  type EfficiencyScore,
} from '../../lib/efficiency';
import {
  portfolioBlockers,
  portfolioHealth,
  priorityProjects,
  urgentLifecycleWork,
} from '../../lib/dashboard-portfolio';
import { prettyEnum } from '../../lib/sales';

const PORTFOLIO_PREVIEW_CAP = 3;
const DAY_MS = 86_400_000;

function greetingFor(now: Date): string {
  const h = now.getHours();
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  return 'Good evening';
}

/** Whole calendar days until a due date (negative = past). */
function daysUntil(dueDate: string, now: Date): number {
  const due = new Date(dueDate);
  const a = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  const b = Date.UTC(due.getUTCFullYear(), due.getUTCMonth(), due.getUTCDate());
  return Math.round((b - a) / DAY_MS);
}

/**
 * What the top-of-dashboard banner is showing. One shape for both candidates —
 * an overdue Kanban task and a stuck approval queue — so the banner renders
 * identically whichever wins, and "whichever is most urgent" is a plain
 * comparison of `hoursWaiting`.
 */
interface UrgentFocus {
  /** Hours since the deadline passed / since the oldest item started waiting. */
  hoursWaiting: number;
  amount: number;
  amountLabel: string;
  eyebrow: string;
  title: string;
  subtitle: string;
  href: string;
}

/**
 * Pick the banner's subject: the most-overdue task vs the longest-waiting
 * approval. An approval only competes once it has crossed the shared aging
 * boundary (24h, the Pings escalation line) — a queue that is merely non-empty
 * isn't urgent, and would otherwise permanently replace "you're clear".
 */
function mostUrgentFocus(
  task: MyCard | null,
  approval: OldestApproval | null,
  now: Date,
): UrgentFocus | null {
  const candidates: UrgentFocus[] = [];
  if (task?.dueDate) {
    candidates.push({
      hoursWaiting: ageHours(task.dueDate, now),
      amount: -daysUntil(task.dueDate, now),
      amountLabel: 'days over',
      eyebrow: 'Most urgent task',
      title: task.title,
      subtitle: task.boardName ?? 'My Task',
      href: `/kanban/cards/${task.id}`,
    });
  }
  if (approval && approval.tier !== 'ok') {
    candidates.push({
      hoursWaiting: approval.hoursWaiting,
      amount: Math.floor(approval.hoursWaiting / 24),
      amountLabel: 'days waiting',
      eyebrow: 'Oldest pending approval',
      title: approval.queue.label,
      subtitle: `${approval.count} awaiting your decision`,
      href: approval.queue.hrefs[0],
    });
  }
  return (
    candidates.sort((a, b) => b.hoursWaiting - a.hoursWaiting)[0] ?? null
  );
}

/** Heat color by days overdue — the spec's three-step scale. */
function heat(daysOver: number): string {
  if (daysOver >= 15) return '#FF5257';
  if (daysOver >= 7) return '#F2703A';
  return '#E08A2C';
}

export default function DashboardPage() {
  const { user } = useAuth();
  // Same hook the sidebar badges use (polled + refetched on focus), so the
  // banner and the badges can never disagree about what's waiting.
  const { counts } = usePendingApprovalCounts();

  const [firstName, setFirstName] = useState<string | null>(null);
  const [cards, setCards] = useState<MyCard[] | null>(null);
  const [projects, setProjects] = useState<ProjectProgress[]>([]);
  const [plmWork, setPlmWork] = useState<PlmDashboardItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [receivedPings, setReceivedPings] = useState<ReceivedPing[]>([]);
  const [sentPings, setSentPings] = useState<SentPing[]>([]);
  const [efficiency, setEfficiency] = useState<EfficiencyScore | null>(null);
  const [activeTab, setActiveTab] = useState<'projects' | 'lifecycle'>(
    'projects',
  );

  // The shell's <main> stretches to the tallest flex sibling (the sidebar nav),
  // so it can run taller than this page's surface. While the dashboard is
  // mounted, this attribute (a) paints the content column in the page's
  // theme-matched background and (b) provides the CSS variables for the few
  // inline-styled chart colors (see globals.css).
  useEffect(() => {
    document.body.dataset.signalPage = '';
    return () => {
      delete document.body.dataset.signalPage;
    };
  }, []);

  // A single "now" per render pass keeps greeting/quote/counters consistent.
  const now = useMemo(() => new Date(), []);
  const quote = useMemo(() => quoteOfTheDay(now), [now]);
  const greeting = greetingFor(now);

  useEffect(() => {
    if (!user) return;
    let alive = true;
    Promise.allSettled([
      apiFetch<Employee>(`/employees/${user.sub}`),
      myCards(),
      listProjectProgress(),
      getMyPlmWork(),
      getReceivedPings(),
      getSentPings(),
      getMyEfficiencyScore(),
    ]).then(
      ([
        emp,
        cardsRes,
        projectsRes,
        plmRes,
        receivedRes,
        sentRes,
        efficiencyRes,
      ]) => {
        if (!alive) return;
        if (emp.status === 'fulfilled') setFirstName(emp.value.firstName);
        setCards(cardsRes.status === 'fulfilled' ? cardsRes.value : []);
        setProjects(
          projectsRes.status === 'fulfilled' ? projectsRes.value : [],
        );
        setPlmWork(plmRes.status === 'fulfilled' ? plmRes.value : []);
        setReceivedPings(
          receivedRes.status === 'fulfilled' ? receivedRes.value : [],
        );
        setSentPings(sentRes.status === 'fulfilled' ? sentRes.value : []);
        setEfficiency(
          efficiencyRes.status === 'fulfilled' ? efficiencyRes.value : null,
        );
        if (cardsRes.status === 'fulfilled')
          window.sessionStorage.removeItem('kanban-dashboard-dirty');
        setLoading(false);
      },
    );
    return () => {
      alive = false;
    };
  }, [user]);

  // Keep analytics fresh if a card is completed from a modal. The custom event
  // handles a modal rendered alongside this page; the session flag covers the
  // dashboard → deep link → board modal → browser-back flow.
  useEffect(() => {
    let alive = true;
    const refreshIfDirty = () => {
      if (window.sessionStorage.getItem('kanban-dashboard-dirty') !== '1')
        return;
      myCards()
        .then((next) => {
          if (!alive) return;
          setCards(next);
          window.sessionStorage.removeItem('kanban-dashboard-dirty');
          getMyEfficiencyScore()
            .then((score) => alive && setEfficiency(score))
            .catch(() => undefined);
        })
        .catch(() => undefined);
    };
    window.addEventListener('kanban:card-moved', refreshIfDirty);
    window.addEventListener('focus', refreshIfDirty);
    window.addEventListener('pageshow', refreshIfDirty);
    refreshIfDirty();
    return () => {
      alive = false;
      window.removeEventListener('kanban:card-moved', refreshIfDirty);
      window.removeEventListener('focus', refreshIfDirty);
      window.removeEventListener('pageshow', refreshIfDirty);
    };
  }, []);

  // Project lamps stay live on a dashboard left open during the working day.
  useEffect(() => {
    let alive = true;
    const refresh = () => {
      listProjectProgress()
        .then((next) => alive && setProjects(next))
        .catch(() => undefined);
    };
    const timer = window.setInterval(refresh, 60_000);
    window.addEventListener('focus', refresh);
    return () => {
      alive = false;
      window.clearInterval(timer);
      window.removeEventListener('focus', refresh);
    };
  }, []);

  const stats = useMemo(() => taskStats(cards ?? [], now), [cards, now]);
  const trends = useMemo(
    () => ({
      assigned: counterTrend(cards ?? [], 'assigned', now),
      completed: counterTrend(cards ?? [], 'completed', now),
      overdue: counterTrend(cards ?? [], 'overdue', now),
    }),
    [cards, now],
  );

  // My Tasks: active cards ranked most-overdue first (the spec's sort).
  const tasks = useMemo(() => {
    const active = (cards ?? []).filter((c) => !c.isDone);
    return active.sort((a, b) => {
      if (!a.dueDate && !b.dueDate) return 0;
      if (!a.dueDate) return 1;
      if (!b.dueDate) return -1;
      return new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime();
    });
  }, [cards]);
  const mostUrgentOverdue = useMemo(
    () => tasks.find((t) => t.isOverdue) ?? null,
    [tasks],
  );
  // The banner surfaces the single most urgent thing in the whole workload, so
  // it weighs the most-overdue task against the longest-waiting approval (any
  // queue) and shows whichever has been sitting longer.
  const urgentFocus = useMemo(
    () => mostUrgentFocus(mostUrgentOverdue, oldestPendingApproval(counts, now), now),
    [mostUrgentOverdue, counts, now],
  );
  const maxDaysOver = useMemo(
    () =>
      Math.max(
        1,
        ...tasks
          .filter((t) => t.isOverdue && t.dueDate)
          .map((t) => -daysUntil(t.dueDate!, now)),
      ),
    [tasks, now],
  );

  const refreshPings = () =>
    Promise.all([
      getReceivedPings(),
      getSentPings(),
      getMyEfficiencyScore(),
    ]).then(([received, sent, score]) => {
      setReceivedPings(received);
      setSentPings(sent);
      setEfficiency(score);
    });

  const projectPreview = useMemo(
    () => priorityProjects(projects, PORTFOLIO_PREVIEW_CAP),
    [projects],
  );
  const lifecyclePreview = useMemo(
    () => urgentLifecycleWork(plmWork, PORTFOLIO_PREVIEW_CAP),
    [plmWork],
  );
  const health = useMemo(() => portfolioHealth(projects), [projects]);
  const blockers = useMemo(() => portfolioBlockers(plmWork), [plmWork]);
  const awaitingReply = sentPings.filter((p) =>
    p.recipients.some((r) => r.status === 'PENDING'),
  ).length;
  const projectsAtRisk = health.atRisk + health.blocked;

  const dateLabel = now
    .toLocaleDateString('en-GB', {
      weekday: 'short',
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    })
    .replace(',', '');

  if (loading) {
    return (
      <div className="-m-4 flex min-h-[70vh] items-center justify-center bg-[#F4F4F4] dark:bg-[#1B1B1B] md:-m-6">
        <Spinner className="text-[#1B1B1B] dark:text-[#EDEDED]" />
      </div>
    );
  }

  return (
    <div className="-m-4 min-h-[calc(100dvh-3.5rem)] bg-[#F4F4F4] text-[#1B1B1B] dark:bg-[#1B1B1B] dark:text-[#EDEDED] md:-m-6">
      {/* Context bar. The three filter pills that used to sit here were inert
          placeholders; the slot now carries live signal instead — what's waiting
          on this user, and how long they've been on the clock today. */}
      <div className="flex items-center gap-2.5 border-b border-black/10 dark:border-white/[.07] bg-[#ECECEC] dark:bg-[#1F1F1F] px-5 py-[11px] lg:px-7">
        <span className="hidden text-[11.5px] font-semibold text-black/45 dark:text-white/40 sm:inline">
          {dateLabel}
        </span>
        <span className="hidden h-3.5 w-px bg-black/15 dark:bg-white/[.12] sm:inline" />
        <PendingApprovalsMenu counts={counts} now={now} />
        <span className="h-3.5 w-px bg-black/15 dark:bg-white/[.12]" />
        <CheckinTimer />
        {(stats.overdue > 0 || projectsAtRisk > 0) && (
          <span className="ml-auto text-[11.5px] font-semibold text-[#D9363E] dark:text-[#FF5257]">
            ⚠ {stats.overdue} overdue
            <span className="hidden sm:inline">
              {projectsAtRisk > 0
                ? ` · ${projectsAtRisk} projects at risk`
                : ''}
            </span>
          </span>
        )}
      </div>

      {/* Hero: greeting + quote, urgent-task focus card. */}
      <div className="grid items-center gap-[26px] px-5 pb-[22px] pt-[26px] lg:px-7 xl:grid-cols-[1fr_460px]">
        <header className="space-y-4">
          <h1 className="text-2xl font-semibold tracking-tight">
            {greeting}
            {firstName ? `, ${firstName}` : ''}
          </h1>
          <figure className="border-l-2 border-primary/40 pl-4">
            <blockquote className="font-voice text-xl font-medium leading-snug text-foreground sm:text-2xl">
              “{quote.text}”
            </blockquote>
            <figcaption className="mt-1 text-sm text-muted-foreground">
              — {quote.author}
            </figcaption>
          </figure>
        </header>
        {urgentFocus ? (
          <UrgentFocusCard focus={urgentFocus} />
        ) : (
          <div className="rounded-xl border border-black/10 dark:border-white/[.08] bg-white dark:bg-[#232323] p-[18px] text-[12px] text-black/40 dark:text-white/[.32]">
            Nothing overdue — you’re clear.
          </div>
        )}
      </div>

      {/* KPI strip. */}
      <div className="mx-5 grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-black/10 dark:border-white/[.08] bg-black/10 dark:bg-white/[.08] lg:mx-7 xl:grid-cols-4">
        <KpiTile
          label="Assigned"
          value={stats.assigned}
          trend={trends.assigned}
          stroke="var(--sd-spark)"
          href="/my-tasks?status=assigned"
        />
        <KpiTile
          label="Completed"
          value={stats.completed}
          valueClass="text-[#1E9E63] dark:text-[#3DD68C]"
          deltaClass="text-[#1E9E63] dark:text-[#3DD68C]"
          trend={trends.completed}
          stroke="var(--sd-success)"
          href="/my-tasks?status=completed"
        />
        <KpiTile
          label="Due soon"
          value={stats.dueSoon}
          valueClass={
            stats.dueSoon === 0
              ? 'text-black/35 dark:text-white/[.28]'
              : undefined
          }
          deltaLabel="7 days"
          href="/my-tasks?status=due-soon"
          zeroCopy={
            stats.dueSoon === 0 && stats.overdue > 0
              ? 'Clear window — everything pending is already late.'
              : stats.dueSoon === 0
                ? 'Nothing due in the next 7 days.'
                : undefined
          }
        />
        <KpiTile
          label="Overdue"
          value={stats.overdue}
          valueClass="text-[#D9363E] dark:text-[#FF5257]"
          labelClass="text-[#C13438] dark:text-[#FF8A8D]"
          deltaClass="text-[#D9363E] dark:text-[#FF5257]"
          trend={trends.overdue}
          stroke="var(--sd-danger)"
          href="/my-tasks?status=overdue"
          danger
        />
      </div>

      {/* Analytics row. */}
      <div className="mx-5 mt-4 grid gap-4 md:grid-cols-2 lg:mx-7 xl:grid-cols-[1.1fr_.9fr_1.1fr]">
        <Panel>
          <div className="flex items-center justify-between">
            <span className="text-[13.5px] font-semibold">
              Efficiency score
            </span>
            <span className="rounded-[5px] border border-black/15 dark:border-white/[.14] px-[7px] py-[3px] text-[10px] font-medium text-black/45 dark:text-white/40">
              Private to you
            </span>
          </div>
          <div className="mt-3.5 flex items-center gap-4">
            <Dial
              pct={efficiency?.score ?? 0}
              label={
                efficiency?.score === null || !efficiency
                  ? '—'
                  : `${efficiency.score}%`
              }
              labelClass="text-[#C9761B] dark:text-[#E08A2C]"
            />
            <div className="min-w-0 flex-1">
              <div className="text-[11px] leading-[1.45] text-black/50 dark:text-white/[.42]">
                Rolling last {efficiency?.windowDays ?? 30} days · SLA outcomes,
                not response speed
              </div>
              <div className="mt-3 flex flex-col gap-2">
                <MetricBar
                  label="Pings on time"
                  part={efficiency?.ping ?? null}
                  goodColor="var(--sd-success)"
                  badColor="var(--sd-success)"
                />
                <MetricBar
                  label="Tasks on time"
                  part={efficiency?.task ?? null}
                  goodColor="var(--sd-success)"
                  badColor="var(--sd-danger)"
                />
              </div>
            </div>
          </div>
        </Panel>

        <Panel>
          <div className="text-[13.5px] font-semibold">Portfolio health</div>
          <div className="mt-[3px] text-[11px] text-black/45 dark:text-white/40">
            Your visible projects at a glance
          </div>
          {projects.length === 0 ? (
            <p className="mt-4 text-[12px] text-black/40 dark:text-white/[.32]">
              No visible projects.
            </p>
          ) : (
            <div className="mt-4 flex items-center gap-[18px]">
              <HealthDonut health={health} total={projects.length} />
              <div className="flex flex-1 flex-col gap-[9px]">
                <LegendRow
                  color="#3DD68C"
                  label="On track"
                  count={health.onTrack}
                />
                <LegendRow
                  color="#E08A2C"
                  label="At risk"
                  count={health.atRisk}
                />
                <LegendRow
                  color="#E5484D"
                  label="Blocked"
                  count={health.blocked}
                />
              </div>
            </div>
          )}
        </Panel>

        <Panel className="hidden xl:block">
          <div className="text-[13.5px] font-semibold">
            Top lifecycle blockers
          </div>
          <div className="mt-[3px] text-[11px] text-black/45 dark:text-white/40">
            Most common reasons across your active order lines
          </div>
          <BlockerBars blockers={blockers} />
        </Panel>
      </div>

      {/* Work row: task queue + pings. */}
      <div className="mx-5 mt-4 grid items-start gap-4 lg:mx-7 xl:grid-cols-[1.45fr_1fr]">
        <section className="flex h-[430px] min-h-0 flex-col overflow-hidden rounded-xl border border-black/10 bg-white dark:border-white/[.08] dark:bg-[#232323]">
          <div className="flex items-center gap-2.5 px-5 pb-[13px] pt-4">
            <span className="text-[17px] font-bold tracking-[-.4px]">
              My tasks
            </span>
            {stats.overdue > 0 && (
              <span className="rounded-full bg-[#E5484D]/[.14] px-2 py-[3px] text-[10.5px] font-semibold text-[#D9363E] dark:text-[#FF5257]">
                {stats.overdue} overdue
              </span>
            )}
            <span className="ml-auto hidden text-[11px] font-medium text-black/40 dark:text-white/35 xl:inline">
              Sorted by days over ↓
            </span>
            <Link
              href="/my-tasks"
              className="text-[12px] font-semibold text-[#3B6FB5] dark:text-[#6FA3E0]"
            >
              View all
            </Link>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain border-t border-black/[.07] dark:border-white/[.06]">
            {tasks.length === 0 ? (
              <p className="px-5 py-[18px] text-[12px] text-black/40 dark:text-white/[.32]">
                No tasks assigned to you.
              </p>
            ) : (
              tasks.map((t) => (
                <TaskRow
                  key={t.id}
                  task={t}
                  now={now}
                  maxDaysOver={maxDaysOver}
                />
              ))
            )}
          </div>
        </section>

        <PingsCard
          received={receivedPings}
          sent={sentPings}
          awaitingReply={awaitingReply}
          now={now}
          onChanged={refreshPings}
        />
      </div>

      {/* Tabbed lists — capped at 3 cards each; the rest lives behind View more. */}
      <div className="mx-5 mb-[30px] mt-4 overflow-hidden rounded-xl border border-black/10 dark:border-white/[.08] bg-white dark:bg-[#232323] lg:mx-7">
        <div className="flex items-center gap-1.5 border-b border-black/10 dark:border-white/[.08] px-5 py-[13px]">
          <TabPill
            active={activeTab === 'projects'}
            onClick={() => setActiveTab('projects')}
          >
            Project progress
          </TabPill>
          <TabPill
            active={activeTab === 'lifecycle'}
            onClick={() => setActiveTab('lifecycle')}
          >
            Product lifecycle work
          </TabPill>
          <Link
            href={activeTab === 'projects' ? '/project-kickoff' : '/plm'}
            className="ml-auto text-[12px] font-semibold text-[#3B6FB5] dark:text-[#6FA3E0]"
          >
            View more →
          </Link>
        </div>
        {activeTab === 'projects' ? (
          projectPreview.length === 0 ? (
            <p className="px-5 py-[18px] text-[12px] text-black/40 dark:text-white/[.32]">
              No projects to show.
            </p>
          ) : (
            <div className="grid gap-px bg-black/[.08] dark:bg-white/[.07] md:grid-cols-3">
              {projectPreview.map((p) => (
                <ProjectCard key={p.kickoffId} project={p} />
              ))}
            </div>
          )
        ) : lifecyclePreview.length === 0 ? (
          <p className="px-5 py-[18px] text-[12px] text-black/40 dark:text-white/[.32]">
            No active order lines to show.
          </p>
        ) : (
          <div className="grid gap-px bg-black/[.08] dark:bg-white/[.07] md:grid-cols-3">
            {lifecyclePreview.map((l) => (
              <LifecycleCard key={l.trackerId} item={l} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Building blocks ─────────────────────────────────────────────────────────

function Panel({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        'rounded-xl border border-black/10 dark:border-white/[.08] bg-white dark:bg-[#232323] px-5 py-[18px]',
        className,
      )}
    >
      {children}
    </div>
  );
}

function UrgentFocusCard({ focus }: { focus: UrgentFocus }) {
  const { amount: daysOver, amountLabel, eyebrow, title, subtitle, href } = focus;
  return (
    <div className="flex items-center gap-[18px] rounded-xl border border-[#E5484D]/35 bg-gradient-to-br from-[#E5484D]/20 to-[#E5484D]/5 px-[18px] py-4">
      <div className="flex-none text-center">
        <div className="text-[34px] font-extrabold leading-[.9] tracking-[-1.6px] text-[#D9363E] dark:text-[#FF5257] xl:text-[40px] xl:tracking-[-2px]">
          {daysOver}
        </div>
        <div className="mt-[5px] text-[9.5px] font-semibold uppercase tracking-[.16em] text-black/50 dark:text-white/45">
          {amountLabel}
        </div>
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-[9.5px] font-semibold uppercase tracking-[.16em] text-[#C13438] dark:text-[#FF8A8D]">
          {eyebrow}
        </div>
        <div className="mt-[5px] text-[15px] font-bold leading-[1.3] xl:text-[16px]">
          {title}
        </div>
        <div className="mt-[3px] text-[11.5px] text-black/50 dark:text-white/[.42]">
          {subtitle}
        </div>
      </div>
      <Link
        href={href}
        className="flex-none rounded-lg bg-[#3B6FB5] px-[15px] py-[9px] text-[12px] font-bold text-white"
      >
        Open
      </Link>
    </div>
  );
}

function Sparkline({ series, stroke }: { series: number[]; stroke: string }) {
  const max = Math.max(...series, 1);
  const min = Math.min(...series);
  const range = Math.max(max - min, 1);
  const points = series
    .map((v, i) => {
      const x = (i / (series.length - 1)) * 120;
      const y = 25 - ((v - min) / range) * 19;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');
  return (
    <svg
      viewBox="0 0 120 28"
      preserveAspectRatio="none"
      className="mt-2.5 block h-[26px] w-full"
      aria-hidden
    >
      <polyline
        points={points}
        fill="none"
        style={{ stroke }}
        strokeWidth={2}
      />
    </svg>
  );
}

function formatDelta(weekDelta: number): string {
  if (weekDelta > 0) return `+${weekDelta} wk`;
  if (weekDelta < 0) return `−${Math.abs(weekDelta)} wk`;
  return '±0 wk';
}

function KpiTile({
  label,
  value,
  trend,
  stroke,
  href,
  valueClass,
  labelClass,
  deltaClass,
  deltaLabel,
  zeroCopy,
  danger,
}: {
  label: string;
  value: number;
  trend?: CounterTrend;
  stroke?: string;
  href: string;
  valueClass?: string;
  labelClass?: string;
  deltaClass?: string;
  deltaLabel?: string;
  zeroCopy?: string;
  danger?: boolean;
}) {
  return (
    <Link
      href={href}
      className={cn(
        'relative block bg-white dark:bg-[#232323] px-[18px] py-4 transition-colors hover:bg-black/[.03] dark:hover:bg-[#282828] xl:px-5 xl:py-[18px]',
        danger &&
          'bg-gradient-to-b from-[#FDECEC] to-white dark:from-[#2A1E1F] dark:to-[#232323]',
      )}
      aria-label={`View ${value} ${label.toLowerCase()} tasks`}
    >
      {danger && (
        <span className="absolute bottom-0 left-0 top-0 w-[3px] bg-[#E5484D]" />
      )}
      <div className="flex items-center justify-between">
        <span
          className={cn(
            'text-[10px] font-semibold uppercase tracking-[.14em] text-black/50 dark:text-white/45',
            labelClass,
          )}
        >
          {label}
        </span>
        <span
          className={cn(
            'hidden text-[10.5px] font-semibold tabular-nums text-black/40 dark:text-white/35 xl:inline',
            deltaClass,
          )}
        >
          {deltaLabel ?? (trend ? formatDelta(trend.weekDelta) : '')}
        </span>
      </div>
      <div
        className={cn(
          'mt-1.5 text-[38px] font-extrabold leading-none tracking-[-1.8px] xl:mt-2 xl:text-[46px] xl:tracking-[-2.2px]',
          valueClass,
        )}
      >
        {value}
      </div>
      {zeroCopy ? (
        <div className="mt-3 hidden text-[11.5px] leading-[1.4] text-black/40 dark:text-white/[.33] xl:block">
          {zeroCopy}
        </div>
      ) : (
        trend &&
        stroke && (
          <div className="hidden xl:block">
            <Sparkline series={trend.series} stroke={stroke} />
          </div>
        )
      )}
    </Link>
  );
}

function Dial({
  pct,
  label,
  labelClass,
}: {
  pct: number;
  label: string;
  labelClass?: string;
}) {
  const clamped = Math.max(0, Math.min(100, pct));
  return (
    <div
      className="grid size-[76px] flex-none place-items-center rounded-full xl:size-24"
      style={{
        background: `conic-gradient(#E08A2C 0 ${clamped}%, var(--sd-track) ${clamped}% 100%)`,
      }}
    >
      <div className="grid size-[56px] place-items-center rounded-full bg-white dark:bg-[#232323] xl:size-[70px]">
        <span
          className={cn(
            'text-[19px] font-extrabold tracking-[-.8px] xl:text-2xl xl:tracking-[-1px]',
            labelClass,
          )}
        >
          {label}
        </span>
      </div>
    </div>
  );
}

function MetricBar({
  label,
  part,
  goodColor,
  badColor,
}: {
  label: string;
  part: EfficiencyScore['ping'] | null;
  goodColor: string;
  badColor: string;
}) {
  const pct = part?.percentage ?? null;
  const color =
    pct === null ? 'var(--sd-faint)' : pct >= 50 ? goodColor : badColor;
  return (
    <div>
      <div className="flex justify-between text-[11px] font-medium text-black/60 dark:text-white/55">
        <span>{label}</span>
        <span className="font-bold" style={{ color }}>
          {pct === null
            ? 'No eligible outcomes'
            : `${pct}% (${part!.onTime}/${part!.total})`}
        </span>
      </div>
      <div className="mt-1 h-[5px] overflow-hidden rounded-[3px] bg-black/10 dark:bg-white/[.08]">
        <div
          className="h-full"
          style={{ width: `${pct ?? 0}%`, background: color }}
        />
      </div>
    </div>
  );
}

function HealthDonut({
  health,
  total,
}: {
  health: { onTrack: number; atRisk: number; blocked: number };
  total: number;
}) {
  const stops: string[] = [];
  let acc = 0;
  for (const [count, color] of [
    [health.onTrack, '#3DD68C'],
    [health.atRisk, '#E08A2C'],
    [health.blocked, '#E5484D'],
  ] as const) {
    if (count === 0) continue;
    const from = (acc / total) * 100;
    acc += count;
    const to = (acc / total) * 100;
    stops.push(`${color} ${from}% ${to}%`);
  }
  return (
    <div
      className="grid size-[76px] flex-none place-items-center rounded-full xl:size-24"
      style={{
        background: `conic-gradient(${stops.join(',') || 'var(--sd-track) 0 100%'})`,
      }}
    >
      <div className="grid size-[54px] place-items-center rounded-full bg-white dark:bg-[#232323] text-center xl:size-16">
        <div>
          <div className="text-[20px] font-extrabold leading-none tracking-[-.8px] xl:text-2xl xl:tracking-[-1px]">
            {total}
          </div>
          <div className="text-[9px] text-black/50 dark:text-white/45 xl:text-[9.5px]">
            projects
          </div>
        </div>
      </div>
    </div>
  );
}

function LegendRow({
  color,
  label,
  count,
}: {
  color: string;
  label: string;
  count: number;
}) {
  return (
    <div
      className={cn(
        'flex items-center gap-2 text-[12px] font-medium',
        count === 0 && 'text-black/60 dark:text-white/55',
      )}
    >
      <span className="size-[7px] rounded-full" style={{ background: color }} />
      {label}
      <span className="ml-auto font-bold">{count}</span>
    </div>
  );
}

function BlockerBars({
  blockers,
}: {
  blockers: Array<{ reason: string; count: number }>;
}) {
  if (blockers.length === 0) {
    return (
      <p className="mt-4 text-[12px] text-black/40 dark:text-white/[.32]">
        No blockers logged.
      </p>
    );
  }
  const max = blockers[0].count;
  return (
    <div className="mt-[18px]">
      {blockers.map((b, i) => (
        <div
          key={b.reason}
          className={cn('flex items-center gap-3', i > 0 && 'mt-[9px]')}
        >
          <span
            className="w-[170px] flex-none truncate text-[12px] font-medium text-black/75 dark:text-white/75"
            title={b.reason}
          >
            {b.reason}
          </span>
          <div className="flex h-[30px] flex-1 items-center overflow-hidden rounded-md bg-black/[.06] dark:bg-white/[.06]">
            <div
              className="flex h-full items-center justify-end bg-gradient-to-r from-[#E5484D] to-[#A82F34] pr-[9px] text-[12px] font-bold text-white"
              style={{ width: `${(b.count / max) * 100}%` }}
            >
              {b.count}
            </div>
          </div>
        </div>
      ))}
      {blockers.length === 1 && (
        <div className="mt-[9px] flex items-center gap-3 opacity-45">
          <span className="w-[170px] flex-none text-[12px] font-medium">
            No other blockers logged
          </span>
          <div className="h-[30px] flex-1 rounded-md bg-black/5 dark:bg-white/5" />
        </div>
      )}
      <div className="mt-2 flex justify-between pl-[182px] text-[10px] tabular-nums text-black/35 dark:text-white/[.28]">
        {Array.from({ length: max + 1 }, (_, i) => (
          <span key={i}>{i}</span>
        ))}
      </div>
    </div>
  );
}

function TaskRow({
  task,
  now,
  maxDaysOver,
}: {
  task: MyCard;
  now: Date;
  maxDaysOver: number;
}) {
  const daysOver = task.dueDate ? -daysUntil(task.dueDate, now) : null;
  const overdue = task.isOverdue && daysOver !== null && daysOver > 0;
  const color = overdue ? heat(daysOver) : 'var(--sd-faint)';
  const rightLabel = overdue
    ? `${daysOver} days over`
    : daysOver !== null
      ? daysOver === 0
        ? 'due today'
        : `due in ${-daysOver}d`
      : 'no due date';
  return (
    <Link
      href={`/kanban/cards/${task.id}`}
      className="grid grid-cols-[40px_1fr_78px] items-center gap-3 border-t border-black/[.07] dark:border-white/[.06] px-5 py-3 transition-colors hover:bg-black/[.03] dark:hover:bg-white/[.03] xl:grid-cols-[44px_1fr_120px_74px] xl:gap-3.5"
    >
      <div
        className="text-[18px] font-extrabold leading-none tracking-[-.8px] xl:text-xl xl:tracking-[-.9px]"
        style={{ color }}
      >
        {overdue ? daysOver : daysOver !== null ? Math.abs(daysOver) : '—'}
        <span className="text-[9px] font-semibold tracking-normal xl:text-[10px]">
          d
        </span>
      </div>
      <div className="min-w-0">
        <div className="truncate text-[13px] font-semibold xl:text-[13.5px]">
          {task.title}
        </div>
        {task.boardName && (
          <div className="mt-0.5 text-[10.5px] text-black/45 dark:text-white/40 xl:text-[11px]">
            {task.boardName}
          </div>
        )}
      </div>
      <div className="hidden h-1.5 overflow-hidden rounded-[3px] bg-black/[.08] dark:bg-white/[.07] xl:block">
        <div
          className="h-full"
          style={{
            width: overdue
              ? `${Math.round((daysOver / maxDaysOver) * 100)}%`
              : 0,
            background: color,
          }}
        />
      </div>
      <div className="text-right text-[10.5px] font-semibold text-black/40 dark:text-white/35 xl:text-[11px]">
        {rightLabel}
      </div>
    </Link>
  );
}

function PingsCard({
  received,
  sent,
  awaitingReply,
  now,
  onChanged,
}: {
  received: ReceivedPing[];
  sent: SentPing[];
  awaitingReply: number;
  now: Date;
  onChanged: () => void;
}) {
  const [activePingTab, setActivePingTab] = useState<'received' | 'sent'>(
    'received',
  );
  const visible = orderReceivedForDashboard(received);
  const act = async (id: string, status: 'ACKNOWLEDGED' | 'RESOLVED') => {
    await respondToPing(id, status);
    onChanged();
  };
  return (
    <section className="flex h-[430px] min-h-0 flex-col overflow-hidden rounded-xl border border-black/10 bg-white dark:border-white/[.08] dark:bg-[#232323]">
      <div className="flex items-center gap-2.5 px-5 pb-[13px] pt-4">
        <span className="text-[17px] font-bold tracking-[-.4px]">Pings</span>
        {awaitingReply > 0 && (
          <span className="rounded-full bg-black/10 dark:bg-white/[.08] px-2 py-[3px] text-[10.5px] font-semibold text-black/65 dark:text-white/60">
            {awaitingReply} awaiting reply
          </span>
        )}
        <Link
          href="/my-pings"
          className="ml-auto text-[12px] font-semibold text-[#3B6FB5] dark:text-[#6FA3E0]"
        >
          View all
        </Link>
      </div>

      <div
        className="flex border-y border-black/[.07] bg-black/[.025] px-3 pt-1 dark:border-white/[.06] dark:bg-white/[.025]"
        role="tablist"
        aria-label="Ping direction"
      >
        <PingTab
          active={activePingTab === 'received'}
          count={visible.length}
          onClick={() => setActivePingTab('received')}
        >
          Received
        </PingTab>
        <PingTab
          active={activePingTab === 'sent'}
          count={sent.length}
          onClick={() => setActivePingTab('sent')}
        >
          Sent
        </PingTab>
      </div>

      <div
        className="min-h-0 flex-1 overflow-y-auto overscroll-contain"
        role="tabpanel"
      >
        {activePingTab === 'received' ? (
          visible.length === 0 ? (
            <p className="px-5 py-[18px] text-[12px] text-black/40 dark:text-white/[.32]">
              No pings waiting.
            </p>
          ) : (
            visible.map((row) => {
              const hours = pingAgeHours(row.ping.createdAt, now);
              const overdue = isPingOverdue(row.status, hours);
              const href = linkedPingHref(
                row.ping.linkedRecordType,
                row.ping.linkedRecordId,
              );
              return (
                <div
                  key={row.id}
                  className="flex gap-3 border-b border-black/[.07] px-5 py-3.5 last:border-b-0 dark:border-white/[.06]"
                >
                  <div
                    className="w-[3px] flex-none rounded-sm"
                    style={{
                      background:
                        row.status === 'PENDING'
                          ? overdue
                            ? '#E5484D'
                            : '#F2703A'
                          : '#3DD68C',
                    }}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="text-[12.5px] font-medium leading-[1.45]">
                      {row.ping.message}
                    </div>
                    <div className="mt-1 text-[10.5px] text-black/45 dark:text-white/40">
                      {row.ping.fromEmployee.fullName} · {hours}h ago
                      {overdue ? ` · ${hours - 24}h overdue` : ''}
                    </div>
                    {href && (
                      <Link
                        href={href}
                        className="mt-1 block text-[10.5px] font-semibold text-[#3B6FB5] dark:text-[#6FA3E0]"
                      >
                        Open linked record
                      </Link>
                    )}
                    {row.status === 'PENDING' ? (
                      <div className="mt-2 flex gap-1.5">
                        <button
                          onClick={() => void act(row.id, 'ACKNOWLEDGED')}
                          className="rounded-md border border-black/15 px-2.5 py-1 text-[10.5px] font-semibold text-black/75 hover:bg-black/[.05] dark:border-white/[.14] dark:text-white/75 dark:hover:bg-white/[.06]"
                        >
                          Acknowledge
                        </button>
                        <button
                          onClick={() => void act(row.id, 'RESOLVED')}
                          className="rounded-md bg-[#3B6FB5] px-2.5 py-1 text-[10.5px] font-bold text-white"
                        >
                          Resolve
                        </button>
                      </div>
                    ) : (
                      <span className="mt-1.5 inline-block rounded-[5px] bg-[#3DD68C]/[.14] px-2 py-1 text-[10px] font-semibold text-[#1E9E63] dark:text-[#3DD68C]">
                        {row.status === 'RESOLVED'
                          ? 'Resolved'
                          : 'Acknowledged'}
                      </span>
                    )}
                  </div>
                </div>
              );
            })
          )
        ) : sent.length === 0 ? (
          <p className="px-5 py-[18px] text-[12px] text-black/40 dark:text-white/[.32]">
            No sent pings.
          </p>
        ) : (
          sent.map((ping) => {
            const anyPending = ping.recipients.some(
              (recipient) => recipient.status === 'PENDING',
            );
            return (
              <div
                key={ping.id}
                className="flex gap-3 border-b border-black/[.07] px-5 py-3.5 last:border-b-0 dark:border-white/[.06]"
              >
                <div
                  className="w-[3px] flex-none rounded-sm"
                  style={{ background: anyPending ? '#E5484D' : '#3DD68C' }}
                />
                <div className="min-w-0 flex-1">
                  <div className="text-[12.5px] font-medium leading-[1.45]">
                    {ping.message}
                  </div>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {ping.recipients.map((recipient) => (
                      <span
                        key={recipient.id}
                        className={cn(
                          'rounded-[5px] px-2 py-1 text-[10px] font-semibold',
                          recipient.status === 'PENDING'
                            ? 'bg-[#E5484D]/[.14] text-[#C13438] dark:text-[#FF8A8D]'
                            : 'bg-[#3DD68C]/[.14] text-[#1E9E63] dark:text-[#3DD68C]',
                        )}
                      >
                        {recipient.employee.fullName}:{' '}
                        {recipient.status === 'PENDING'
                          ? 'Pending'
                          : recipient.status === 'RESOLVED'
                            ? 'Resolved'
                            : 'Acknowledged'}
                      </span>
                    ))}
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>
    </section>
  );
}

function PingTab({
  active,
  count,
  onClick,
  children,
}: {
  active: boolean;
  count: number;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={cn(
        'relative flex min-h-9 items-center gap-1.5 px-3 text-[11px] font-semibold transition-colors',
        active
          ? 'text-black dark:text-white'
          : 'text-black/45 hover:text-black/70 dark:text-white/40 dark:hover:text-white/70',
      )}
    >
      {children}
      <span className="rounded-full bg-black/[.07] px-1.5 py-0.5 text-[9px] dark:bg-white/[.08]">
        {count}
      </span>
      {active && (
        <span className="absolute inset-x-2 bottom-0 h-0.5 rounded-full bg-[#3B6FB5] dark:bg-[#6FA3E0]" />
      )}
    </button>
  );
}

function TabPill({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'rounded-full px-3.5 py-[7px] text-[12px] font-bold transition-colors',
        active
          ? 'bg-[#3B6FB5] text-white'
          : 'text-black/60 dark:text-white/55 hover:text-black/80 dark:hover:text-white/80',
      )}
    >
      {children}
    </button>
  );
}

function HealthChip({
  health,
}: {
  health: 'ON_TRACK' | 'AT_RISK' | 'BLOCKED';
}) {
  const styles = {
    ON_TRACK: 'bg-[#3DD68C]/[.14] text-[#1E9E63] dark:text-[#3DD68C]',
    AT_RISK: 'bg-[#E08A2C]/[.16] text-[#C9761B] dark:text-[#E08A2C]',
    BLOCKED: 'bg-[#E5484D]/[.16] text-[#C13438] dark:text-[#FF8A8D]',
  }[health];
  const label = {
    ON_TRACK: 'On track',
    AT_RISK: 'At risk',
    BLOCKED: 'Blocked',
  }[health];
  return (
    <span
      className={cn(
        'flex-none rounded-[5px] px-2 py-[3px] text-[10px] font-semibold',
        styles,
      )}
    >
      {label}
    </span>
  );
}

function ProjectCard({ project }: { project: ProjectProgress }) {
  const completed = project.stages.filter((s) => s.state === 'COMPLETE').length;
  const total = project.stages.length || 1;
  return (
    <Link
      href={`/project-kickoff/${project.kickoffId}`}
      className="block bg-white dark:bg-[#232323] px-[19px] py-[17px] transition-colors hover:bg-black/[.03] dark:hover:bg-[#282828]"
    >
      <div className="flex items-start gap-2.5">
        <div className="min-w-0 flex-1 truncate text-[13px] font-semibold leading-[1.35]">
          {project.projectName}
        </div>
        <HealthChip health={project.health} />
      </div>
      <div className="mt-1.5 truncate text-[11px] tabular-nums text-black/45 dark:text-white/40">
        {project.orderNumber} · {prettyEnum(project.currentStage)}
        {project.nextDueDate
          ? ` · Due ${new Date(project.nextDueDate).toLocaleDateString()}`
          : ''}
      </div>
      <div className="mt-[13px] flex items-center gap-2">
        <div className="h-2 flex-1 overflow-hidden rounded bg-black/[.08] dark:bg-white/[.07]">
          <div
            className="h-full rounded bg-gradient-to-r from-[#3DD68C] to-[#E08A2C]"
            style={{ width: `${Math.round((completed / total) * 100)}%` }}
          />
        </div>
        <span className="text-[11px] font-semibold tabular-nums text-black/65 dark:text-white/60">
          {completed}/{total}
        </span>
      </div>
      {project.healthReason !== 'No active blockers' && (
        <div
          className="mt-[9px] truncate text-[11px] leading-[1.5] text-black/45 dark:text-white/40"
          title={project.healthReason}
        >
          {project.healthReason}
        </div>
      )}
    </Link>
  );
}

function LifecycleCard({ item }: { item: PlmDashboardItem }) {
  const urgency =
    item.daysUntilDue !== null && item.daysUntilDue < 0
      ? `${-item.daysUntilDue}d overdue`
      : item.daysUntilDue !== null
        ? `due in ${item.daysUntilDue}d`
        : `${item.ageDays}d in stage`;
  return (
    <Link
      href={plmTrackerHref(item.trackerId)}
      className="block bg-white dark:bg-[#232323] px-[19px] py-[17px] transition-colors hover:bg-black/[.03] dark:hover:bg-[#282828]"
    >
      <div className="flex items-start gap-2.5">
        <div className="min-w-0 flex-1 truncate text-[13px] font-semibold leading-[1.35]">
          {item.orderNumber} · {item.productName}
        </div>
        <HealthChip health={item.health} />
      </div>
      <div className="mt-1.5 truncate text-[11px] tabular-nums text-black/45 dark:text-white/40">
        {prettyEnum(item.currentStage)} · {item.ownerName} · {urgency}
      </div>
      {item.blocker && (
        <div className="mt-[13px] flex items-center gap-[7px] rounded-lg bg-[#E5484D]/10 px-[11px] py-[9px] text-[11.5px] font-medium text-[#C13438] dark:text-[#FF8A8D]">
          ⚠ {item.blocker}
        </div>
      )}
    </Link>
  );
}
