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
  const assigned = cards.filter((card) => !card.isDone);
  return {
    assigned: assigned.length,
    completed: cards.filter((card) => card.isDone).length,
    dueSoon: assigned.filter((card) => {
      if (!card.dueDate || card.isOverdue) return false;
      const days = daysUntil(card.dueDate, now);
      return days >= 0 && days <= 3;
    }).length,
    overdue: assigned.filter((card) => card.isOverdue).length,
  };
}

/** Active cards assigned to the current user, across all boards. */
export function myCards() {
  return apiFetch<MyCard[]>('/kanban/cards/mine');
}
