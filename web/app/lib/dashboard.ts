'use client';

import { apiFetch } from './api';

/** A Kanban card assigned to the current user, flattened for the dashboard. */
export interface MyCard {
  id: string;
  title: string;
  boardId: string;
  boardName: string | null;
  dueDate: string | null;
  isDone: boolean;
  isOverdue: boolean;
  createdAt: string;
  /** When the card entered a done list; approximate for legacy completions. */
  completedAt: string | null;
}

export type TaskFilter =
  | 'all'
  | 'assigned'
  | 'completed'
  | 'due-soon'
  | 'overdue';

const DAY_MS = 86_400_000;

function daysUntil(dueDate: string, now: Date): number {
  const due = new Date(dueDate);
  const today = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  const deadline = Date.UTC(
    due.getUTCFullYear(),
    due.getUTCMonth(),
    due.getUTCDate(),
  );
  return Math.round((deadline - today) / DAY_MS);
}

/** Dashboard totals derived solely from the server's done-list classification. */
export function taskStats(cards: MyCard[], now: Date) {
  return {
    assigned: filterMyCards(cards, 'assigned', now).length,
    completed: filterMyCards(cards, 'completed', now).length,
    dueSoon: filterMyCards(cards, 'due-soon', now).length,
    overdue: filterMyCards(cards, 'overdue', now).length,
  };
}

/**
 * Canonical category logic shared by the dashboard counters and My Tasks.
 * Keeping this in one function prevents a filter count from drifting from the
 * stat card that links to it.
 */
export function filterMyCards(
  cards: MyCard[],
  filter: TaskFilter,
  now: Date,
): MyCard[] {
  if (filter === 'all') return cards;
  if (filter === 'completed') return cards.filter((card) => card.isDone);

  const assigned = cards.filter((card) => !card.isDone);
  if (filter === 'assigned') return assigned;
  if (filter === 'overdue') return assigned.filter((card) => card.isOverdue);
  return assigned.filter((card) => {
    if (!card.dueDate || card.isOverdue) return false;
    const days = daysUntil(card.dueDate, now);
    return days >= 0 && days <= 3;
  });
}

/** Active cards assigned to the current user, across all boards. */
export function myCards() {
  return apiFetch<MyCard[]>('/kanban/cards/mine');
}

// ── KPI history (sparklines + week-over-week deltas) ────────────────────────
// Reconstructed from the current card set's real timestamps (createdAt /
// completedAt / dueDate) — no synthetic data. Cards deleted or reassigned in
// the window are absent from the history; legacy completions carry an
// approximate completedAt.

export type TrendCounter = 'assigned' | 'completed' | 'overdue';

export interface CounterTrend {
  /** Daily value at each end-of-day, oldest first (last entry = today). */
  series: number[];
  /** Today's value minus the value 7 days ago. */
  weekDelta: number;
}

function countOn(cards: MyCard[], counter: TrendCounter, endOfDay: number) {
  return cards.filter((card) => {
    const created = new Date(card.createdAt).getTime();
    const completed = card.completedAt
      ? new Date(card.completedAt).getTime()
      : null;
    const doneBy = completed !== null && completed <= endOfDay;
    if (counter === 'completed') return doneBy;
    if (created > endOfDay || doneBy) return false;
    if (counter === 'assigned') return true;
    return !!card.dueDate && new Date(card.dueDate).getTime() < endOfDay;
  }).length;
}

/** Real daily history for one KPI counter over the trailing `days` days. */
export function counterTrend(
  cards: MyCard[],
  counter: TrendCounter,
  now: Date,
  days = 14,
): CounterTrend {
  const series: number[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const endOfDay = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate() - i,
      23,
      59,
      59,
      999,
    ).getTime();
    series.push(countOn(cards, counter, endOfDay));
  }
  const today = series[series.length - 1];
  const weekAgo = series[series.length - 8] ?? series[0];
  return { series, weekDelta: today - weekAgo };
}
