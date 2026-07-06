import { cn } from '../../lib/utils';

/**
 * Initials avatar circle — the single people-list avatar used across the app
 * (My Team, Team Attendance, and any future roster/people view). Derives up
 * to two initials from the name; colour is a deterministic muted accent so
 * the same person reads consistently.
 */
export function Avatar({
  name,
  className,
}: {
  name: string;
  className?: string;
}) {
  const initials =
    name
      .trim()
      .split(/\s+/)
      .slice(0, 2)
      .map((part) => part.charAt(0).toUpperCase())
      .join('') || '?';

  return (
    <span
      className={cn(
        'inline-flex size-8 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-semibold text-muted-foreground',
        className,
      )}
      aria-hidden="true"
    >
      {initials}
    </span>
  );
}
