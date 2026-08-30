/**
 * The one definition of "is this piece of kickoff work still open / late".
 *
 * These four predicates were previously inlined in three places — the action
 * item's read projection (`toActionItem`), the project-health inputs
 * (`progressForScope`), and the executive PM dashboard — and the three had
 * quietly drifted apart: one treated an ARCHIVED card as an open action, one
 * ignored a milestone explicitly marked DELAYED, and only one honoured the
 * "done list" flag. A PM Head reading "3 overdue" next to a project badge that
 * says On Track is a bug in exactly that gap, so all callers now import from
 * here and the numbers are the same number by construction.
 *
 * Deliberately pure and structurally typed (no Prisma enum imports): every
 * caller passes plain fields, which keeps this unit-testable and free of a
 * database dependency.
 */

/** The action item's status is COMPUTED from its linked Kanban card, never stored. */
export type ActionItemComputedStatus =
  'TODO' | 'IN_PROGRESS' | 'DONE' | 'ARCHIVED' | 'UNLINKED';

/** The card an action item hangs off. Null once the card is deleted. */
export interface ActionItemCardShape {
  status: string;
  list: { name: string; isDoneList: boolean };
}

/**
 * Derive an action item's live status from its card's list.
 *
 * A deleted card yields UNLINKED rather than DONE: the item lost its live
 * status, which is not the same as having been completed (see the schema note
 * on KickoffActionItem).
 */
export function deriveActionItemStatus(
  card: ActionItemCardShape | null | undefined,
): ActionItemComputedStatus {
  if (!card) return 'UNLINKED';
  if (card.status === 'ARCHIVED') return 'ARCHIVED';
  if (card.list.isDoneList) return 'DONE';
  // Heuristic: the lowest open list is "to do"; any other open list is
  // in-progress. Only the name/flag is stored, so treat a common "to do" name
  // as TODO and everything else open as IN_PROGRESS.
  return /to\s*do|backlog/i.test(card.list.name) ? 'TODO' : 'IN_PROGRESS';
}

/**
 * Still real work, i.e. counted against the project. ARCHIVED and UNLINKED are
 * excluded on purpose — neither is an open task somebody is going to do, and
 * counting them inflates every "incomplete" number on the dashboard.
 */
export function isActionItemOpen(status: ActionItemComputedStatus): boolean {
  return status === 'TODO' || status === 'IN_PROGRESS';
}

/** Open and past its due date. Undated open items are open but never "late". */
export function isActionItemOverdue(
  item: { dueDate: Date | null; kanbanCard?: ActionItemCardShape | null },
  now: Date,
): boolean {
  return (
    !!item.dueDate &&
    item.dueDate.getTime() < now.getTime() &&
    isActionItemOpen(deriveActionItemStatus(item.kanbanCard))
  );
}

/**
 * Late, or explicitly flagged as slipping. A milestone someone has marked
 * DELAYED counts as overdue even before its target date passes — that flag is a
 * PM telling us it will not land, and ignoring it until the date passes wastes
 * the warning.
 */
export function isMilestoneOverdue(
  milestone: { status: string; targetDate: Date },
  now: Date,
): boolean {
  return (
    milestone.status !== 'COMPLETED' &&
    (milestone.status === 'DELAYED' ||
      milestone.targetDate.getTime() < now.getTime())
  );
}

/** Open, and severe on either axis of the likelihood/impact matrix. */
export function isRiskHighImpactOpen(risk: {
  status: string;
  likelihood: string;
  impact: string;
}): boolean {
  return (
    risk.status === 'OPEN' &&
    (risk.impact === 'HIGH' || risk.likelihood === 'HIGH')
  );
}
