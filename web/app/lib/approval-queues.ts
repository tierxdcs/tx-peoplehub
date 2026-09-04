import { ageHours, queueTier, type UrgencyTier } from './urgency';

/**
 * ONE registry of every pending-approval queue the app badges.
 *
 * It is the single join between the `/notifications/pending-counts` payload and
 * the UI: the sidebar maps each queue onto the nav hrefs that should carry its
 * badge, and the dashboard's urgent banner walks the same list to find the
 * oldest-waiting approval anywhere in the user's workload. Adding a queue means
 * adding one entry here plus its counterpart in the backend entity — nothing
 * else needs to know the set.
 */

/** Per-queue summary as returned by GET /notifications/pending-counts. */
export interface PendingQueue {
  count: number;
  /** When the OLDEST still-pending item started waiting. null when empty. */
  oldestPendingAt: string | null;
}

export type ApprovalQueueKey =
  | 'leaveApprovals'
  | 'hrPendingAccess'
  | 'bidDiscountApprovals'
  | 'bidAssessmentApprovals'
  | 'confirmationSheetsPending'
  | 'offerLetterApprovals'
  | 'provisioningApprovals'
  | 'candidateRequisitionApprovals'
  | 'bomReleaseApprovals'
  | 'expenseClaimApprovals'
  | 'adHocPoApprovals'
  | 'designChangeApprovals';

export interface ApprovalQueueDef {
  key: ApprovalQueueKey;
  /** Queue name as shown in the dashboard banner. */
  label: string;
  /**
   * Every nav href that should carry this queue's badge. hrefs[0] is the link
   * the banner opens, so it must be reachable by everyone the queue routes to.
   */
  hrefs: [string, ...string[]];
}

export const APPROVAL_QUEUES: readonly ApprovalQueueDef[] = [
  {
    key: 'leaveApprovals',
    label: 'Leave requests',
    // The manager route admits MANAGER/ADMIN/SUPER_ADMIN and hits the same
    // scoped endpoint, so it is the safe banner target for every approver.
    hrefs: ['/team/leave-approvals', '/admin/leave-approvals'],
  },
  {
    key: 'hrPendingAccess',
    label: 'Employees awaiting access',
    hrefs: ['/admin/pending-access'],
  },
  {
    key: 'bidDiscountApprovals',
    label: 'Bid discount approvals',
    hrefs: ['/sales/bids/pending-approval'],
  },
  {
    key: 'bidAssessmentApprovals',
    label: 'Bid/No-Bid assessments',
    hrefs: ['/sales/bid-assessments/pending-approval'],
  },
  {
    key: 'confirmationSheetsPending',
    label: 'Order confirmation sheets',
    hrefs: ['/sales/confirmation-sheets/pending-approval'],
  },
  {
    key: 'offerLetterApprovals',
    label: 'Offer letter approvals',
    hrefs: ['/hr/offer-letters/pending-approval'],
  },
  {
    key: 'provisioningApprovals',
    label: 'Provisioning requests',
    hrefs: ['/hr/provisioning-approvals'],
  },
  {
    key: 'candidateRequisitionApprovals',
    label: 'Candidate requisitions',
    hrefs: ['/hr/candidate-requisitions'],
  },
  {
    key: 'bomReleaseApprovals',
    label: 'BOM releases',
    hrefs: ['/scm/bom/pending-approval'],
  },
  {
    key: 'expenseClaimApprovals',
    label: 'Expense claims',
    hrefs: ['/finance/expense-claims'],
  },
  {
    key: 'adHocPoApprovals',
    label: 'Purchase order approvals',
    hrefs: ['/stores/purchase-orders'],
  },
  {
    key: 'designChangeApprovals',
    label: 'Engineering changes (ECR)',
    hrefs: ['/design/changes'],
  },
] as const;

/** The whole payload: one summary per registered queue, always present. */
export type PendingCounts = Record<ApprovalQueueKey, PendingQueue>;

/**
 * Flatten the payload into the sidebar's href → badge map. A queue with no
 * pending items is omitted entirely, so an empty queue renders no badge (same
 * as before this change).
 */
export function approvalBadgesByHref(
  counts: PendingCounts | null,
): Record<string, PendingQueue> {
  const badges: Record<string, PendingQueue> = {};
  if (!counts) return badges;
  for (const queue of APPROVAL_QUEUES) {
    const summary = counts[queue.key];
    if (!summary || summary.count <= 0) continue;
    for (const href of queue.hrefs) badges[href] = summary;
  }
  return badges;
}

/**
 * How many approvals are waiting on this user across every queue.
 *
 * Walks the same registry the sidebar badges do, so the dashboard's single
 * number always equals the sum of the badges the user can see. Each queue is
 * already role-scoped server-side (a queue the caller can't approve reports 0),
 * so this needs no permission logic of its own.
 */
export function totalPendingApprovals(counts: PendingCounts | null): number {
  if (!counts) return 0;
  return APPROVAL_QUEUES.reduce(
    (total, queue) => total + (counts[queue.key]?.count ?? 0),
    0,
  );
}

export interface OldestApproval {
  queue: ApprovalQueueDef;
  count: number;
  oldestPendingAt: string;
  hoursWaiting: number;
  tier: UrgencyTier;
}

/** One non-empty queue, with where it goes and how long it has been waiting. */
export interface PendingApprovalQueue {
  queue: ApprovalQueueDef;
  count: number;
  /** null when the queue reports no waiting-since stamp for its oldest item. */
  oldestPendingAt: string | null;
  href: string;
  hoursWaiting: number;
  tier: UrgencyTier;
}

/**
 * Every queue with something in it, longest-waiting first — the rows of the
 * dashboard's approvals dropdown. Queues that report no waiting-since stamp
 * count as zero hours and sink to the bottom rather than being dropped: the user
 * still has to act on them, we just can't say how overdue they are.
 *
 * Sorting is stable, so queues that have waited the same whole number of hours
 * stay in registry order.
 */
export function pendingApprovalQueues(
  counts: PendingCounts | null,
  now: Date = new Date(),
): PendingApprovalQueue[] {
  if (!counts) return [];
  return APPROVAL_QUEUES.filter((queue) => (counts[queue.key]?.count ?? 0) > 0)
    .map((queue) => {
      const summary = counts[queue.key];
      return {
        queue,
        count: summary.count,
        oldestPendingAt: summary.oldestPendingAt,
        href: queue.hrefs[0],
        hoursWaiting: summary.oldestPendingAt
          ? ageHours(summary.oldestPendingAt, now)
          : 0,
        tier: queueTier(summary.oldestPendingAt, now),
      };
    })
    .sort((a, b) => b.hoursWaiting - a.hoursWaiting);
}

/**
 * The single longest-waiting pending approval across every queue — what the
 * dashboard banner compares against the most-overdue Kanban task. Queues that
 * are empty, or whose oldest item carries no waiting-since stamp, are skipped.
 */
export function oldestPendingApproval(
  counts: PendingCounts | null,
  now: Date = new Date(),
): OldestApproval | null {
  for (const row of pendingApprovalQueues(counts, now)) {
    if (!row.oldestPendingAt) continue;
    return {
      queue: row.queue,
      count: row.count,
      oldestPendingAt: row.oldestPendingAt,
      hoursWaiting: row.hoursWaiting,
      tier: row.tier,
    };
  }
  return null;
}
