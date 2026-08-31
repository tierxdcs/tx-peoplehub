import { describe, expect, it } from 'vitest';
import {
  APPROVAL_QUEUES,
  approvalBadgesByHref,
  oldestPendingApproval,
  totalPendingApprovals,
  type PendingCounts,
} from './approval-queues';

const NOW = new Date('2026-03-10T12:00:00.000Z');

function hoursAgo(hours: number): string {
  return new Date(NOW.getTime() - hours * 3_600_000).toISOString();
}

/** All queues empty, then override only the ones a test cares about. */
function counts(overrides: Partial<PendingCounts> = {}): PendingCounts {
  const empty = Object.fromEntries(
    APPROVAL_QUEUES.map((q) => [q.key, { count: 0, oldestPendingAt: null }]),
  ) as PendingCounts;
  return { ...empty, ...overrides };
}

describe('totalPendingApprovals', () => {
  it('reads as zero before the payload has loaded', () => {
    expect(totalPendingApprovals(null)).toBe(0);
  });

  it('is zero when every queue is empty', () => {
    expect(totalPendingApprovals(counts())).toBe(0);
  });

  it('sums across queues, so the ribbon equals the badges the user sees', () => {
    expect(
      totalPendingApprovals(
        counts({
          leaveApprovals: { count: 3, oldestPendingAt: hoursAgo(30) },
          bomReleaseApprovals: { count: 2, oldestPendingAt: hoursAgo(4) },
          expenseClaimApprovals: { count: 1, oldestPendingAt: hoursAgo(1) },
        }),
      ),
    ).toBe(6);
  });

  it('tolerates a payload missing a queue the client knows about', () => {
    // A backend deployed before a newly registered queue omits its key; the
    // ribbon should under-report rather than render NaN.
    const partial = counts({ leaveApprovals: { count: 2, oldestPendingAt: null } });
    delete (partial as Record<string, unknown>).bomReleaseApprovals;
    expect(totalPendingApprovals(partial)).toBe(2);
  });
});

describe('approvalBadgesByHref', () => {
  it('returns nothing before the payload has loaded', () => {
    expect(approvalBadgesByHref(null)).toEqual({});
  });

  it('omits empty queues entirely', () => {
    expect(approvalBadgesByHref(counts())).toEqual({});
  });

  it('badges every href a queue registers', () => {
    const leave = { count: 3, oldestPendingAt: hoursAgo(30) };
    const badges = approvalBadgesByHref(counts({ leaveApprovals: leave }));

    expect(badges).toEqual({
      '/team/leave-approvals': leave,
      '/admin/leave-approvals': leave,
    });
  });

  it('covers each of the newly badged queues', () => {
    const summary = { count: 1, oldestPendingAt: hoursAgo(4) };
    const badges = approvalBadgesByHref(
      counts({
        candidateRequisitionApprovals: summary,
        bomReleaseApprovals: summary,
        expenseClaimApprovals: summary,
        adHocPoApprovals: summary,
        designChangeApprovals: summary,
      }),
    );

    expect(Object.keys(badges).sort()).toEqual([
      '/design/changes',
      '/finance/expense-claims',
      '/hr/candidate-requisitions',
      '/scm/bom/pending-approval',
      '/stores/purchase-orders',
    ]);
  });
});

describe('oldestPendingApproval', () => {
  it('is null with no payload and with nothing pending', () => {
    expect(oldestPendingApproval(null, NOW)).toBeNull();
    expect(oldestPendingApproval(counts(), NOW)).toBeNull();
  });

  it('picks the longest-waiting queue across types', () => {
    const picked = oldestPendingApproval(
      counts({
        leaveApprovals: { count: 2, oldestPendingAt: hoursAgo(30) },
        expenseClaimApprovals: { count: 5, oldestPendingAt: hoursAgo(100) },
        designChangeApprovals: { count: 1, oldestPendingAt: hoursAgo(80) },
      }),
      NOW,
    );

    expect(picked?.queue.key).toBe('expenseClaimApprovals');
    expect(picked?.count).toBe(5);
    expect(picked?.hoursWaiting).toBe(100);
    expect(picked?.tier).toBe('stale');
  });

  it('reports the shared tier for a queue that is only aging', () => {
    const picked = oldestPendingApproval(
      counts({ bomReleaseApprovals: { count: 1, oldestPendingAt: hoursAgo(25) } }),
      NOW,
    );

    expect(picked?.queue.key).toBe('bomReleaseApprovals');
    expect(picked?.tier).toBe('aging');
  });

  it('skips a non-empty queue with no waiting-since stamp', () => {
    const picked = oldestPendingApproval(
      counts({
        adHocPoApprovals: { count: 4, oldestPendingAt: null },
        leaveApprovals: { count: 1, oldestPendingAt: hoursAgo(2) },
      }),
      NOW,
    );

    expect(picked?.queue.key).toBe('leaveApprovals');
  });

  it('ignores a stale stamp on a queue that has been cleared', () => {
    expect(
      oldestPendingApproval(
        counts({ leaveApprovals: { count: 0, oldestPendingAt: hoursAgo(500) } }),
        NOW,
      ),
    ).toBeNull();
  });

  it('opens a link the queue actually registers', () => {
    const picked = oldestPendingApproval(
      counts({ leaveApprovals: { count: 1, oldestPendingAt: hoursAgo(90) } }),
      NOW,
    );

    expect(picked?.queue.hrefs[0]).toBe('/team/leave-approvals');
  });
});
