'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  ListChecks,
  CheckCircle2,
  Clock,
  AlertTriangle,
  AlertCircle,
} from 'lucide-react';
import { useAuth } from '../../lib/auth-context';
import { apiFetch } from '../../lib/api';
import { Employee } from '../../lib/types';
import { myCards, taskStats, type MyCard } from '../../lib/dashboard';
import {
  listProjectProgress,
  type ProjectProgress,
} from '../../lib/project-kickoff';
import { quoteOfTheDay } from '../../lib/quotes';
import { useVertical } from '../../lib/use-vertical';
import { flowForVertical } from '../../lib/process-flows';
import { PageContainer } from '../../components/ui/page-container';
import { Card, CardContent } from '../../components/ui/card';
import { EmptyState } from '../../components/ui/empty-state';
import { Spinner } from '../../components/ui/spinner';
import { cn } from '../../lib/utils';
import { DeadlineChip, deadlineLabel } from './_components/deadline-chip';
import { ProcessFlowModal } from './_components/process-flow-modal';
import { ProjectProgressCard } from './_components/project-progress-card';

const TASK_CAP = 8;
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

export default function DashboardPage() {
  const { user } = useAuth();
  const { vertical } = useVertical();

  const [firstName, setFirstName] = useState<string | null>(null);
  const [cards, setCards] = useState<MyCard[] | null>(null);
  const [projects, setProjects] = useState<ProjectProgress[]>([]);
  const [loading, setLoading] = useState(true);

  // A single "now" per render pass keeps greeting/quote/chips consistent.
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
    ]).then(([emp, cardsRes, projectsRes]) => {
      if (!alive) return;
      if (emp.status === 'fulfilled') setFirstName(emp.value.firstName);
      setCards(cardsRes.status === 'fulfilled' ? cardsRes.value : []);
      setProjects(projectsRes.status === 'fulfilled' ? projectsRes.value : []);
      if (cardsRes.status === 'fulfilled')
        window.sessionStorage.removeItem('kanban-dashboard-dirty');
      setLoading(false);
    });
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
  // Refresh on focus and every minute; failures retain the last good snapshot.
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

  // ── Task analytics (all computed live) ──────────────────────────────
  const stats = useMemo(() => taskStats(cards ?? [], now), [cards, now]);

  // My Tasks: active (not-done) cards, most-urgent first, capped.
  const tasks = useMemo(() => {
    const active = (cards ?? []).filter((c) => !c.isDone);
    return active.sort((a, b) => {
      // No due date sorts last; otherwise soonest (incl. overdue) first.
      if (!a.dueDate && !b.dueDate) return 0;
      if (!a.dueDate) return 1;
      if (!b.dueDate) return -1;
      return new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime();
    });
  }, [cards]);

  // The single most-urgent overdue task, for the "what's blocking me" line.
  const mostUrgentOverdue = useMemo(
    () => tasks.find((t) => t.isOverdue) ?? null,
    [tasks],
  );

  const flow = flowForVertical(vertical?.code);

  if (loading) {
    return (
      <PageContainer className="flex min-h-[50vh] items-center justify-center">
        <Spinner />
      </PageContainer>
    );
  }

  return (
    <PageContainer className="space-y-8 py-2">
      {/* Greeting + editorial quote — the one serif moment on the page. */}
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

      {/* "What's blocking me" — name the single most urgent overdue item so the
          user doesn't have to scan (spec §8). Only shown when it applies. */}
      {mostUrgentOverdue && (
        <Link
          href={`/kanban/cards/${mostUrgentOverdue.id}`}
          className="flex items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive transition-colors hover:bg-destructive/10"
        >
          <AlertCircle className="size-4 shrink-0" />
          <span>
            <span className="font-medium">{mostUrgentOverdue.title}</span> is{' '}
            {deadlineLabel(mostUrgentOverdue.dueDate!, now).toLowerCase()} —
            your most urgent task.
          </span>
        </Link>
      )}

      {/* Task analytics — 4 stat cards. */}
      <section className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard icon={ListChecks} label="Assigned" value={stats.assigned} />
        <StatCard
          icon={CheckCircle2}
          label="Completed"
          value={stats.completed}
          tone="success"
        />
        <StatCard
          icon={Clock}
          label="Due soon"
          value={stats.dueSoon}
          tone={stats.dueSoon > 0 ? 'warning' : 'muted'}
        />
        <StatCard
          icon={AlertTriangle}
          label="Overdue"
          value={stats.overdue}
          tone={stats.overdue > 0 ? 'danger' : 'muted'}
        />
      </section>

      {/* My Tasks */}
      <section>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-semibold">My tasks</h2>
          {tasks.length > TASK_CAP && (
            <Link
              href="/kanban"
              className="text-sm text-primary hover:underline"
            >
              View all
            </Link>
          )}
        </div>
        <Card>
          <CardContent className="p-0">
            {tasks.length === 0 ? (
              <EmptyState
                icon={ListChecks}
                title="No tasks assigned to you"
                description="Kanban cards assigned to you across all boards show up here. Open a board to pick up work."
              />
            ) : (
              <ul className="divide-y">
                {tasks.slice(0, TASK_CAP).map((t) => (
                  <li key={t.id}>
                    <Link
                      href={`/kanban/cards/${t.id}`}
                      className={cn(
                        'flex items-center gap-3 border-l-2 px-4 py-3 transition-colors hover:bg-accent/40',
                        t.isOverdue
                          ? 'border-l-destructive'
                          : t.dueDate &&
                              daysUntil(t.dueDate, now) <= 3 &&
                              daysUntil(t.dueDate, now) >= 0
                            ? 'border-l-warning'
                            : 'border-l-transparent',
                      )}
                    >
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium">
                          {t.title}
                        </p>
                        {t.boardName && (
                          <p className="truncate text-xs text-muted-foreground">
                            {t.boardName}
                          </p>
                        )}
                      </div>
                      {t.dueDate && (
                        <DeadlineChip
                          dueDate={t.dueDate}
                          isOverdue={t.isOverdue}
                          now={now}
                        />
                      )}
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </section>

      {/* Participant-scoped, live Order-to-Dispatch project tracking. */}
      {projects.length > 0 && (
        <section>
          <div className="mb-3 flex items-end justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold">Project progress</h2>
              <p className="text-sm text-muted-foreground">
                Live status for projects where you attended the kickoff.
              </p>
            </div>
            <Link
              href="/project-kickoff"
              className="shrink-0 text-sm text-primary hover:underline"
            >
              View projects
            </Link>
          </div>
          <div className="space-y-4">
            {projects.map((project) => (
              <ProjectProgressCard key={project.kickoffId} project={project} />
            ))}
          </div>
        </section>
      )}

      {/* Process flow overview (only when the user has a mapped vertical). */}
      {flow && (
        <section>
          <h2 className="mb-3 text-lg font-semibold">Understand the process</h2>
          <ProcessFlowModal flow={flow} />
        </section>
      )}
    </PageContainer>
  );
}

function StatCard({
  icon: Icon,
  label,
  value,
  tone = 'muted',
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: number;
  tone?: 'muted' | 'success' | 'warning' | 'danger';
}) {
  const toneClass = {
    muted: 'text-muted-foreground',
    success: 'text-success',
    warning: 'text-warning',
    danger: 'text-destructive',
  }[tone];
  return (
    <Card>
      <CardContent className="flex items-center gap-3 p-4">
        <div
          className={cn(
            'flex size-9 shrink-0 items-center justify-center rounded-full bg-muted',
            toneClass,
          )}
        >
          <Icon className="size-5" />
        </div>
        <div>
          <p className="text-2xl font-semibold leading-none">{value}</p>
          <p className="mt-1 text-xs text-muted-foreground">{label}</p>
        </div>
      </CardContent>
    </Card>
  );
}
