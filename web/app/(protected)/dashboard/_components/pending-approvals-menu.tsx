'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { ChevronDown } from 'lucide-react';
import {
  pendingApprovalQueues,
  totalPendingApprovals,
  type PendingCounts,
} from '../../../lib/approval-queues';
import { waitingLabel, type UrgencyTier } from '../../../lib/urgency';
import { cn } from '../../../lib/utils';

/**
 * The dashboard's "N awaiting your approval" chip, as a menu.
 *
 * It used to be a single link to the longest-waiting queue, with the full split
 * only visible in a `title` tooltip — which meant the breakdown was unreachable
 * on touch and every other queue took a guess through the sidebar to find. Each
 * row now goes straight to the page where that queue is decided.
 *
 * Rows are ordered longest-waiting first (same order the urgent banner picks its
 * subject from), so the top row is the one worth opening.
 */

/** Waiting time reads as text first; the tint only reinforces it. */
const TIER_TEXT_CLASS: Record<UrgencyTier, string> = {
  ok: 'text-black/40 dark:text-white/40',
  aging: 'text-[#C9761B] dark:text-[#E08A2C]',
  stale: 'text-[#D9363E] dark:text-[#FF5257]',
};

export function PendingApprovalsMenu({
  counts,
  now,
}: {
  counts: PendingCounts | null;
  /** The dashboard's single clock, so every waiting figure agrees. */
  now: Date;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  const total = useMemo(() => totalPendingApprovals(counts), [counts]);
  const rows = useMemo(() => pendingApprovalQueues(counts, now), [counts, now]);

  // Close on outside click / Escape, matching the notification bell.
  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    function onKey(e: KeyboardEvent) {
      if (e.key !== 'Escape') return;
      setOpen(false);
      // Escape hands the chip back its focus; Tab would otherwise restart from
      // the top of the page.
      triggerRef.current?.focus();
    }
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  // A queue clearing while the menu is open (the counts poll) would leave an
  // empty panel hanging.
  useEffect(() => {
    if (rows.length === 0) setOpen(false);
  }, [rows.length]);

  if (total === 0) {
    return (
      <span className="rounded-full px-[11px] py-[5px] text-[11.5px] font-medium text-black/50 dark:text-white/45">
        No approvals pending
      </span>
    );
  }

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        ref={triggerRef}
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        className="flex items-center gap-1 rounded-full bg-[#E08A2C]/[.16] px-[11px] py-[5px] text-[11.5px] font-semibold text-[#C9761B] transition-opacity hover:opacity-80 dark:text-[#E08A2C]"
      >
        {total} awaiting your approval
        <ChevronDown
          className={cn('size-3 transition-transform', open && 'rotate-180')}
        />
      </button>

      {open && (
        <div
          role="menu"
          aria-label="Approvals awaiting you"
          className="absolute left-0 top-full z-50 mt-1.5 w-[19rem] max-w-[calc(100vw-2rem)] overflow-hidden rounded-lg border border-black/10 bg-white shadow-lg dark:border-white/[.08] dark:bg-[#232323]"
        >
          <p className="border-b border-black/[.07] px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-black/40 dark:border-white/[.07] dark:text-white/40">
            Awaiting your approval
          </p>
          <ul className="divide-y divide-black/[.06] dark:divide-white/[.06]">
            {rows.map((row) => (
              <li key={row.queue.key}>
                <Link
                  href={row.href}
                  role="menuitem"
                  onClick={() => setOpen(false)}
                  className="flex min-h-11 items-center gap-3 px-3 py-2 text-left hover:bg-black/[.04] dark:hover:bg-white/[.05]"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[12.5px] font-medium text-[#1B1B1B] dark:text-[#EDEDED]">
                      {row.queue.label}
                    </span>
                    {row.oldestPendingAt && (
                      <span
                        className={cn(
                          'block text-[11px]',
                          TIER_TEXT_CLASS[row.tier],
                        )}
                      >
                        oldest {waitingLabel(row.hoursWaiting)}
                      </span>
                    )}
                  </span>
                  <span className="shrink-0 rounded-full bg-[#E08A2C]/[.16] px-2 py-0.5 text-[11px] font-semibold text-[#C9761B] dark:text-[#E08A2C]">
                    {row.count}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
