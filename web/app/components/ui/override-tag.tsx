import { ShieldAlert } from 'lucide-react';
import { cn } from '../../lib/utils';

/**
 * "Manually overridden" indicator, shown everywhere a vendor/supplier status is
 * displayed when that status came from a SuperAdmin classification override
 * rather than the computed audit score. Keeps the app honest: an approved
 * status that bypassed the scoring gate is never presented as if it were earned
 * by the score. `by` (when known — e.g. on the detail page) names the approver.
 */
export function OverrideTag({
  by,
  className,
}: {
  by?: string | null;
  className?: string;
}) {
  const title = by
    ? `Manually approved by ${by} — see audit for reason`
    : 'Manually overridden — see the audit for the reason';
  return (
    <span
      title={title}
      className={cn(
        'inline-flex items-center gap-1 rounded-full border border-warning/40 bg-warning/10 px-2 py-0.5 text-xs font-medium text-warning',
        className,
      )}
    >
      <ShieldAlert className="size-3" />
      Manually overridden
    </span>
  );
}
