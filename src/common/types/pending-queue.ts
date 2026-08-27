/**
 * A pending-approval queue summarised for the badge layer: how many items are
 * waiting, and when the OLDEST one started waiting.
 *
 * The timestamp is what lets the UI colour a badge by age instead of size, so
 * every queue must answer it with the same field its list endpoint sorts by
 * (`submittedAt` where the workflow stamps one, `createdAt` where the row is
 * created already-pending). Both values come from the SAME where-clause as the
 * queue's list endpoint, so a badge can never disagree with the page it links
 * to. Queues a caller cannot approve return EMPTY_PENDING_QUEUE rather than
 * throwing, so the aggregate endpoint is role-safe by construction.
 */
export interface PendingQueue {
  count: number;
  oldestPendingAt: Date | null;
}

export const EMPTY_PENDING_QUEUE: PendingQueue = Object.freeze({
  count: 0,
  oldestPendingAt: null,
});

/**
 * Summarise rows that had to be filtered in memory (a queue whose scope can't
 * be fully expressed in a where-clause — e.g. the CEO fallback sets, which
 * compare two columns). Rows MUST already be ordered oldest-first, exactly as
 * the list endpoint returns them.
 */
export function pendingQueueFromRows<T>(
  rows: readonly T[],
  waitingSince: (row: T) => Date | null,
): PendingQueue {
  return {
    count: rows.length,
    oldestPendingAt: rows.length ? waitingSince(rows[0]) : null,
  };
}
