'use client';

import { CheckCircle2 } from 'lucide-react';
import {
  intakeProgress,
  type IntakeApprovedQuote,
} from '../../../lib/customer-bom-intake';
import { dateOnlyStr } from '../../../lib/date';
import { Progress } from '../../../components/ui/progress';
import { cn } from '../../../lib/utils';

const MUTED = 'text-black/40 dark:text-white/[.32]';

/** dd/mm/yyyy straight off the date-only string — no timezone can shift it. */
function inDateFormat(iso: string): string {
  const [year, month, day] = dateOnlyStr(iso).split('-');
  return `${day}/${month}/${year}`;
}

/**
 * How much of the promised turnaround is gone, as a bar: raised on → promised
 * for. Amber inside the last three days, red once the date has passed, so a slip
 * is visible from the register without reading any dates.
 */
export function IntakeProgressBar({
  createdAt,
  expectedBy,
  className,
}: {
  createdAt: string;
  expectedBy: string | null;
  className?: string;
}) {
  const progress = intakeProgress(createdAt, expectedBy);
  if (!progress || !expectedBy)
    return <span className={cn('text-[12px]', MUTED)}>No date promised</span>;
  return (
    <div className={cn('min-w-[110px] space-y-1', className)}>
      <Progress
        value={progress.percent}
        className="h-1.5"
        barClassName={
          progress.overdue
            ? 'bg-destructive'
            : progress.daysLeft <= 3
              ? 'bg-warning'
              : 'bg-primary'
        }
      />
      <p
        className={cn(
          'text-[11px] tabular-nums',
          progress.overdue
            ? 'font-semibold text-destructive'
            : progress.daysLeft <= 3
              ? 'text-warning'
              : 'text-black/50 dark:text-white/45',
        )}
      >
        {progress.label} · {inDateFormat(expectedBy)}
      </p>
    </div>
  );
}

/**
 * "The approved quote is in." Set the moment a supplier's quote is awarded on
 * one of the intake's RFQs — that award is what turns into the BOM cost the
 * product is priced from, so it is the signal Sales is actually waiting on.
 */
export function ApprovedQuoteIndicator({
  approvedQuote,
  awaiting,
}: {
  approvedQuote: IntakeApprovedQuote | null;
  /** True while an RFQ is out but no quote has been accepted yet. */
  awaiting: boolean;
}) {
  if (!approvedQuote)
    return (
      <span className={cn('text-[12px]', MUTED)}>
        {awaiting ? 'Awaiting quotes' : '—'}
      </span>
    );
  return (
    <span className="inline-flex items-center gap-1.5 text-[12px] font-medium text-success">
      <CheckCircle2 className="size-3.5" />
      <span>
        Quote received
        <span className="ml-1 font-normal text-black/45 dark:text-white/40">
          {approvedQuote.rfqNumber}
          {/* The award is an instant, not a promised day — show it locally. */}
          {approvedQuote.receivedAt
            ? ` · ${new Date(approvedQuote.receivedAt).toLocaleDateString('en-IN')}`
            : ''}
        </span>
      </span>
    </span>
  );
}
