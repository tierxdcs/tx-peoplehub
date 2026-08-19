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
