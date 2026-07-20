import { cn } from '../../../lib/utils';

/**
 * A deadline chip that carries meaning in TEXT first, colour second (spec §4):
 * urgent cases get relative phrasing ("2 days over", "Due tomorrow"); normal
 * ones get a plain absolute date ("Due 12 Aug"). Colour (danger/warning tint)
 * is only ever a reinforcement — screen-reader and colour-blind users read the
 * same urgency from the words alone. Cards with no deadline render nothing.
 */

const DAY_MS = 86_400_000;

/** Whole calendar days between today and `date` (positive = future). */
function dayDelta(date: Date, now: Date): number {
  const a = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const b = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
  return Math.round((b - a) / DAY_MS);
}

export function deadlineLabel(dueDate: string, now: Date = new Date()): string {
  const due = new Date(dueDate);
  const delta = dayDelta(due, now);
  if (delta < 0) {
    const n = Math.abs(delta);
    return n === 1 ? '1 day over' : `${n} days over`;
  }
  if (delta === 0) return 'Due today';
  if (delta === 1) return 'Due tomorrow';
  if (delta <= 3) return `Due in ${delta} days`;
  return `Due ${due.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}`;
}

export function DeadlineChip({
  dueDate,
  isOverdue,
  now = new Date(),
  className,
}: {
  dueDate: string;
  /** Server-computed: past due AND not in a done list. */
  isOverdue: boolean;
  now?: Date;
  className?: string;
}) {
  const delta = dayDelta(new Date(dueDate), now);
  const dueSoon = !isOverdue && delta >= 0 && delta <= 3;
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium',
        isOverdue && 'bg-destructive/10 text-destructive',
        dueSoon && 'bg-warning/15 text-warning',
        !isOverdue && !dueSoon && 'bg-muted text-muted-foreground',
        className,
      )}
    >
      {deadlineLabel(dueDate, now)}
    </span>
  );
}
