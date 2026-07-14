import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../core/database/prisma.service';

/**
 * Writes the auto-generated, human-readable card activity feed. Entries are
 * system-generated (no create endpoint) — Phase 2's card mutations call in
 * here after a change actually lands. Accepts a transaction client so a card
 * update + its activity entry can be committed atomically. The description
 * builders live here so wording stays consistent in one place.
 *
 * Phase 4 (notifications) will hook the same write-paths that call these
 * builders; keeping the "what changed" logic centralized here makes that clean.
 */
@Injectable()
export class KanbanActivityService {
  constructor(private readonly prisma: PrismaService) {}

  /** Persist a single activity entry (within an optional transaction). */
  async log(
    tx: Prisma.TransactionClient | PrismaService,
    cardId: string,
    actorId: string,
    description: string,
  ): Promise<void> {
    await tx.kanbanCardActivity.create({
      data: { cardId, actorId, description },
    });
  }

  // ── description builders (Trello-style wording) ──────────────────────

  listMoved(oldListName: string, newListName: string): string {
    return `moved this card from ${oldListName} to ${newListName}`;
  }

  assigneeChanged(newAssigneeName: string | null): string {
    return newAssigneeName
      ? `assigned this card to ${newAssigneeName}`
      : 'unassigned this card';
  }

  sprintChanged(newSprintName: string | null): string {
    return newSprintName
      ? `assigned this card to sprint ${newSprintName}`
      : 'removed this card from its sprint';
  }

  priorityChanged(newPriority: string): string {
    return `changed priority to ${newPriority}`;
  }

  /** field: 'due' | 'start'. date is an ISO date, or null when cleared. */
  dateChanged(field: 'due' | 'start', date: string | null): string {
    const label = field === 'due' ? 'due date' : 'start date';
    return date
      ? `set the ${label} to ${date.slice(0, 10)}`
      : `cleared the ${label}`;
  }
}
