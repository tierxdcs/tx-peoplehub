import type { MouseEvent, ReactNode } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

// next/link needs an app router in context; the chip only cares about the href.
// The default is suppressed because jsdom cannot navigate, but the component's
// own onClick still runs — that is what closes the menu.
vi.mock('next/link', () => ({
  default: ({
    href,
    children,
    onClick,
    ...rest
  }: {
    href: string;
    children: ReactNode;
    onClick?: (event: MouseEvent<HTMLAnchorElement>) => void;
  }) => (
    <a
      href={href}
      onClick={(event) => {
        event.preventDefault();
        onClick?.(event);
      }}
      {...rest}
    >
      {children}
    </a>
  ),
}));

import { PendingApprovalsMenu } from './pending-approvals-menu';
import {
  APPROVAL_QUEUES,
  type PendingCounts,
} from '../../../lib/approval-queues';

const NOW = new Date('2026-09-04T09:00:00.000Z');

function hoursAgo(hours: number): string {
  return new Date(NOW.getTime() - hours * 3_600_000).toISOString();
}

function counts(overrides: Partial<PendingCounts> = {}): PendingCounts {
  const empty = Object.fromEntries(
    APPROVAL_QUEUES.map((q) => [q.key, { count: 0, oldestPendingAt: null }]),
  ) as PendingCounts;
  return { ...empty, ...overrides };
}

/** The screenshot's case: 14 approvals spread over five queues. */
const loaded = counts({
  bidAssessmentApprovals: { count: 1, oldestPendingAt: hoursAgo(5) },
  candidateRequisitionApprovals: { count: 7, oldestPendingAt: hoursAgo(90) },
  bomReleaseApprovals: { count: 2, oldestPendingAt: hoursAgo(30) },
  expenseClaimApprovals: { count: 3, oldestPendingAt: null },
  adHocPoApprovals: { count: 1, oldestPendingAt: hoursAgo(2) },
});

describe('PendingApprovalsMenu', () => {
  it('shows the total and keeps the breakdown closed until asked', () => {
    render(<PendingApprovalsMenu counts={loaded} now={NOW} />);

    const chip = screen.getByRole('button', {
      name: /14 awaiting your approval/,
    });
    expect(chip.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('links each queue to the page where it is decided, worst wait first', () => {
    render(<PendingApprovalsMenu counts={loaded} now={NOW} />);
    fireEvent.click(screen.getByRole('button', { name: /awaiting your/ }));

    const items = screen.getAllByRole('menuitem');
    expect(items.map((a) => a.getAttribute('href'))).toEqual([
      '/hr/candidate-requisitions',
      '/scm/bom/pending-approval',
      '/sales/bid-assessments/pending-approval',
      '/stores/purchase-orders',
      // No waiting-since stamp, so it cannot claim a position — it goes last.
      '/finance/expense-claims',
    ]);
    expect(items[0].textContent).toContain('Candidate requisitions');
    expect(items[0].textContent).toContain('7');
    expect(items[0].textContent).toContain('oldest waiting 3 days');
    // Nothing to say about a queue with no stamp; it must not read "under an hour".
    expect(items[4].textContent).not.toContain('waiting');
  });

  it('closes when a queue is opened, so the panel is gone on return', () => {
    render(<PendingApprovalsMenu counts={loaded} now={NOW} />);
    fireEvent.click(screen.getByRole('button', { name: /awaiting your/ }));
    fireEvent.click(screen.getAllByRole('menuitem')[0]);

    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('closes on Escape', () => {
    render(<PendingApprovalsMenu counts={loaded} now={NOW} />);
    fireEvent.click(screen.getByRole('button', { name: /awaiting your/ }));
    fireEvent.keyDown(document, { key: 'Escape' });

    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('offers nothing to open when the user is clear', () => {
    const { rerender } = render(
      <PendingApprovalsMenu counts={counts()} now={NOW} />,
    );
    expect(screen.getByText('No approvals pending')).toBeTruthy();
    expect(screen.queryByRole('button')).toBeNull();

    // …and the same before the counts have loaded at all.
    rerender(<PendingApprovalsMenu counts={null} now={NOW} />);
    expect(screen.getByText('No approvals pending')).toBeTruthy();
  });
});
