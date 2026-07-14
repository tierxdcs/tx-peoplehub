'use client';

import { apiFetch } from './api';
import type { LeadPriority } from './types';

/**
 * Kanban client: entity types (mirroring the backend Kanban entities) plus a
 * thin, typed wrapper around every endpoint. Every function returns the
 * already-unwrapped `data` payload (apiFetch strips the envelope). Access is
 * enforced server-side via KanbanAccessService — these helpers are transport
 * only, no permission logic.
 */

// ── Entity types ─────────────────────────────────────────────────────

export type SprintDuration =
  | 'ONE_WEEK'
  | 'TWO_WEEKS'
  | 'THREE_WEEKS'
  | 'FOUR_WEEKS';

export type SprintStatus = 'UPCOMING' | 'ACTIVE' | 'COMPLETED';

export interface KanbanBoard {
  id: string;
  name: string;
  createdById: string;
  status: 'ACTIVE' | 'ARCHIVED';
  memberCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface KanbanBoardMember {
  id: string;
  boardId: string;
  employeeId: string;
  employeeName: string | null;
  employeeEmail: string | null;
  addedById: string;
  addedAt: string;
}

export interface KanbanList {
  id: string;
  boardId: string;
  name: string;
  position: number;
  isDoneList: boolean;
  cardCount: number;
  createdById: string;
  createdAt: string;
  updatedAt: string;
}

export interface KanbanSprint {
  id: string;
  boardId: string;
  name: string;
  durationWeeks: SprintDuration;
  startDate: string;
  endDate: string;
  status: SprintStatus;
  cardCount: number;
  createdById: string;
  createdAt: string;
  updatedAt: string;
}

export interface KanbanLabel {
  id: string;
  boardId: string;
  name: string;
  color: string;
}

export interface KanbanCard {
  id: string;
  listId: string;
  boardId?: string;
  title: string;
  description: string | null;
  assigneeId: string | null;
  assigneeName: string | null;
  startDate: string | null;
  dueDate: string | null;
  priority: LeadPriority;
  sprintId: string | null;
  position: number;
  createdById: string;
  status: 'ACTIVE' | 'ARCHIVED';
  isOverdue: boolean;
  labels?: KanbanLabel[];
  createdAt: string;
  updatedAt: string;
}

export type FeedItemKind = 'COMMENT' | 'ACTIVITY';

export interface KanbanFeedItem {
  kind: FeedItemKind;
  id: string;
  actorId: string;
  actorName: string | null;
  text: string;
  createdAt: string;
}

/** Board-wide card filter — every field optional, combined with AND server-side. */
export interface CardFilter {
  dueBefore?: string;
  dueAfter?: string;
  createdBy?: string;
  /** A sprint id, or the literal 'none' for cards with no sprint. */
  sprintId?: string;
  assigneeId?: string;
  priority?: LeadPriority;
}

// ── Boards ───────────────────────────────────────────────────────────

export function listBoards() {
  return apiFetch<KanbanBoard[]>('/kanban/boards');
}

export function getBoard(id: string) {
  return apiFetch<KanbanBoard>(`/kanban/boards/${id}`);
}

export function createBoard(name: string) {
  return apiFetch<KanbanBoard>('/kanban/boards', {
    method: 'POST',
    body: JSON.stringify({ name }),
  });
}

export function archiveBoard(id: string) {
  return apiFetch<void>(`/kanban/boards/${id}`, { method: 'DELETE' });
}

// ── Members ──────────────────────────────────────────────────────────

export function listMembers(boardId: string) {
  return apiFetch<KanbanBoardMember[]>(`/kanban/boards/${boardId}/members`);
}

export function addMember(boardId: string, employeeId: string) {
  return apiFetch<KanbanBoardMember>(`/kanban/boards/${boardId}/members`, {
    method: 'POST',
    body: JSON.stringify({ employeeId }),
  });
}

export function removeMember(boardId: string, employeeId: string) {
  return apiFetch<void>(`/kanban/boards/${boardId}/members/${employeeId}`, {
    method: 'DELETE',
  });
}

// ── Lists ────────────────────────────────────────────────────────────

export function listLists(boardId: string) {
  return apiFetch<KanbanList[]>(`/kanban/boards/${boardId}/lists`);
}

export function createList(
  boardId: string,
  input: { name: string; position: number; isDoneList?: boolean },
) {
  return apiFetch<KanbanList>(`/kanban/boards/${boardId}/lists`, {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export function updateList(
  listId: string,
  input: { name?: string; isDoneList?: boolean },
) {
  return apiFetch<KanbanList>(`/kanban/lists/${listId}`, {
    method: 'PATCH',
    body: JSON.stringify(input),
  });
}

export function reorderList(listId: string, position: number) {
  return apiFetch<KanbanList>(`/kanban/lists/${listId}/reorder`, {
    method: 'PATCH',
    body: JSON.stringify({ position }),
  });
}

// ── Sprints ──────────────────────────────────────────────────────────

export function listBoardSprints(boardId: string) {
  return apiFetch<KanbanSprint[]>(`/kanban/boards/${boardId}/sprints`);
}

export function createSprint(
  boardId: string,
  input: { name: string; durationWeeks: SprintDuration; startDate: string },
) {
  return apiFetch<KanbanSprint>(`/kanban/boards/${boardId}/sprints`, {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

/** Sprints across every board the caller belongs to, grouped by computed status. */
export function listAllSprints(boardId?: string) {
  const qs = boardId ? `?boardId=${encodeURIComponent(boardId)}` : '';
  return apiFetch<Record<SprintStatus, KanbanSprint[]>>(`/kanban/sprints${qs}`);
}

// ── Cards ────────────────────────────────────────────────────────────

export function listCards(listId: string) {
  return apiFetch<KanbanCard[]>(`/kanban/lists/${listId}/cards`);
}

export function getCard(cardId: string) {
  return apiFetch<KanbanCard>(`/kanban/cards/${cardId}`);
}

/** Board-wide filtered search; only truthy filters are sent as query params. */
export function filterBoardCards(boardId: string, filter: CardFilter) {
  const params = new URLSearchParams();
  if (filter.dueBefore) params.set('dueBefore', filter.dueBefore);
  if (filter.dueAfter) params.set('dueAfter', filter.dueAfter);
  if (filter.createdBy) params.set('createdBy', filter.createdBy);
  if (filter.sprintId) params.set('sprintId', filter.sprintId);
  if (filter.assigneeId) params.set('assigneeId', filter.assigneeId);
  if (filter.priority) params.set('priority', filter.priority);
  const qs = params.toString();
  return apiFetch<KanbanCard[]>(
    `/kanban/boards/${boardId}/cards${qs ? `?${qs}` : ''}`,
  );
}

export interface CreateCardInput {
  title: string;
  description?: string;
  priority?: LeadPriority;
  startDate?: string;
  dueDate?: string;
  assigneeId?: string;
}

export function createCard(listId: string, input: CreateCardInput) {
  return apiFetch<KanbanCard>(`/kanban/lists/${listId}/cards`, {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export interface UpdateCardInput {
  title?: string;
  description?: string | null;
  priority?: LeadPriority;
  startDate?: string | null;
  dueDate?: string | null;
  assigneeId?: string | null;
}

export function updateCard(cardId: string, input: UpdateCardInput) {
  return apiFetch<KanbanCard>(`/kanban/cards/${cardId}`, {
    method: 'PATCH',
    body: JSON.stringify(input),
  });
}

export function moveCard(cardId: string, listId: string, position: number) {
  return apiFetch<KanbanCard>(`/kanban/cards/${cardId}/move`, {
    method: 'PATCH',
    body: JSON.stringify({ listId, position }),
  });
}

export function setCardSprint(cardId: string, sprintId: string | null) {
  return apiFetch<KanbanCard>(`/kanban/cards/${cardId}/sprint`, {
    method: 'PATCH',
    body: JSON.stringify({ sprintId }),
  });
}

export function archiveCard(cardId: string) {
  return apiFetch<void>(`/kanban/cards/${cardId}`, { method: 'DELETE' });
}

// ── Comments + feed ──────────────────────────────────────────────────

export function getFeed(cardId: string) {
  return apiFetch<KanbanFeedItem[]>(`/kanban/cards/${cardId}/feed`);
}

export function addComment(cardId: string, text: string) {
  return apiFetch<unknown>(`/kanban/cards/${cardId}/comments`, {
    method: 'POST',
    body: JSON.stringify({ text }),
  });
}

export function deleteComment(cardId: string, commentId: string) {
  return apiFetch<void>(`/kanban/cards/${cardId}/comments/${commentId}`, {
    method: 'DELETE',
  });
}

// ── Labels ───────────────────────────────────────────────────────────

export function listLabels(boardId: string) {
  return apiFetch<KanbanLabel[]>(`/kanban/boards/${boardId}/labels`);
}

export function createLabel(
  boardId: string,
  input: { name: string; color: string },
) {
  return apiFetch<KanbanLabel>(`/kanban/boards/${boardId}/labels`, {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export function updateLabel(
  labelId: string,
  input: { name?: string; color?: string },
) {
  return apiFetch<KanbanLabel>(`/kanban/labels/${labelId}`, {
    method: 'PATCH',
    body: JSON.stringify(input),
  });
}

export function deleteLabel(labelId: string) {
  return apiFetch<void>(`/kanban/labels/${labelId}`, { method: 'DELETE' });
}

export function attachLabel(cardId: string, labelId: string) {
  return apiFetch<KanbanCard>(`/kanban/cards/${cardId}/labels/${labelId}`, {
    method: 'POST',
  });
}

export function detachLabel(cardId: string, labelId: string) {
  return apiFetch<KanbanCard>(`/kanban/cards/${cardId}/labels/${labelId}`, {
    method: 'DELETE',
  });
}

// ── Shared UI helpers ────────────────────────────────────────────────

/** Fractional ordering step, matching the server's POSITION_STEP. */
export const POSITION_STEP = 1024;

/**
 * The position to drop an item at, given the (already-reordered) neighbour
 * list and the target index. Mirrors the server's midpoint scheme: between two
 * neighbours → their midpoint; at the head → half the first; at the tail →
 * last + STEP; empty → STEP.
 */
export function positionForIndex(
  positions: number[],
  index: number,
): number {
  if (positions.length === 0) return POSITION_STEP;
  if (index <= 0) return positions[0] / 2;
  if (index >= positions.length) return positions[positions.length - 1] + POSITION_STEP;
  return (positions[index - 1] + positions[index]) / 2;
}

export const PRIORITY_LABEL: Record<LeadPriority, string> = {
  HIGH: 'High',
  MEDIUM: 'Medium',
  LOW: 'Low',
};

export const SPRINT_DURATION_LABEL: Record<SprintDuration, string> = {
  ONE_WEEK: '1 week',
  TWO_WEEKS: '2 weeks',
  THREE_WEEKS: '3 weeks',
  FOUR_WEEKS: '4 weeks',
};

/** A small, fixed palette for labels — name → hex, offered in the label editor. */
export const LABEL_COLORS: { name: string; value: string }[] = [
  { name: 'Green', value: '#22c55e' },
  { name: 'Blue', value: '#3b82f6' },
  { name: 'Purple', value: '#a855f7' },
  { name: 'Red', value: '#ef4444' },
  { name: 'Orange', value: '#f97316' },
  { name: 'Yellow', value: '#eab308' },
  { name: 'Teal', value: '#14b8a6' },
  { name: 'Pink', value: '#ec4899' },
  { name: 'Slate', value: '#64748b' },
];
