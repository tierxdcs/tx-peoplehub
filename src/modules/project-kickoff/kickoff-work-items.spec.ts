import {
  deriveActionItemStatus,
  isActionItemOpen,
  isActionItemOverdue,
  isMilestoneOverdue,
  isRiskHighImpactOpen,
} from './kickoff-work-items';

const NOW = new Date('2026-03-10T09:00:00.000Z');
const YESTERDAY = new Date('2026-03-09T09:00:00.000Z');
const TOMORROW = new Date('2026-03-11T09:00:00.000Z');

describe('kickoff work item predicates', () => {
  describe('deriveActionItemStatus', () => {
    it('is UNLINKED when the card is gone', () => {
      expect(deriveActionItemStatus(null)).toBe('UNLINKED');
      expect(deriveActionItemStatus(undefined)).toBe('UNLINKED');
    });

    it('is ARCHIVED for an archived card, whatever list it sits in', () => {
      expect(
        deriveActionItemStatus({
          status: 'ARCHIVED',
          list: { name: 'To Do', isDoneList: false },
        }),
      ).toBe('ARCHIVED');
    });

    it('honours the done-list flag over the list name', () => {
      expect(
        deriveActionItemStatus({
          status: 'ACTIVE',
          list: { name: 'Shipped', isDoneList: true },
        }),
      ).toBe('DONE');
    });

    it('reads a to-do or backlog list as not yet started', () => {
      expect(
        deriveActionItemStatus({
          status: 'ACTIVE',
          list: { name: 'To  Do', isDoneList: false },
        }),
      ).toBe('TODO');
      expect(
        deriveActionItemStatus({
          status: 'ACTIVE',
          list: { name: 'Backlog', isDoneList: false },
        }),
      ).toBe('TODO');
    });

    it('treats any other live list as in progress', () => {
      expect(
        deriveActionItemStatus({
          status: 'ACTIVE',
          list: { name: 'In Review', isDoneList: false },
        }),
      ).toBe('IN_PROGRESS');
    });
  });

  describe('isActionItemOpen', () => {
    it('counts only work that can still be done', () => {
      expect(isActionItemOpen('TODO')).toBe(true);
      expect(isActionItemOpen('IN_PROGRESS')).toBe(true);
      expect(isActionItemOpen('DONE')).toBe(false);
      // The divergence this module was extracted to kill: an archived or
      // card-less item is not open work somebody is failing to do.
      expect(isActionItemOpen('ARCHIVED')).toBe(false);
      expect(isActionItemOpen('UNLINKED')).toBe(false);
    });
  });

  describe('isActionItemOverdue', () => {
    const openCard = {
      status: 'ACTIVE',
      list: { name: 'In Progress', isDoneList: false },
    };

    it('is overdue when an open item is past its due date', () => {
      expect(
        isActionItemOverdue({ dueDate: YESTERDAY, kanbanCard: openCard }, NOW),
      ).toBe(true);
    });

    it('is not overdue before the due date', () => {
      expect(
        isActionItemOverdue({ dueDate: TOMORROW, kanbanCard: openCard }, NOW),
      ).toBe(false);
    });

    it('is never overdue without a due date', () => {
      expect(
        isActionItemOverdue({ dueDate: null, kanbanCard: openCard }, NOW),
      ).toBe(false);
    });

    it('is not overdue once the item is done or archived', () => {
      expect(
        isActionItemOverdue(
          {
            dueDate: YESTERDAY,
            kanbanCard: {
              status: 'ACTIVE',
              list: { name: 'Done', isDoneList: true },
            },
          },
          NOW,
        ),
      ).toBe(false);
      expect(
        isActionItemOverdue(
          {
            dueDate: YESTERDAY,
            kanbanCard: { ...openCard, status: 'ARCHIVED' },
          },
          NOW,
        ),
      ).toBe(false);
      expect(
        isActionItemOverdue({ dueDate: YESTERDAY, kanbanCard: null }, NOW),
      ).toBe(false);
    });
  });

  describe('isMilestoneOverdue', () => {
    it('is overdue past its target date', () => {
      expect(
        isMilestoneOverdue({ status: 'PENDING', targetDate: YESTERDAY }, NOW),
      ).toBe(true);
    });

    it('is overdue as soon as a PM flags it DELAYED, before the date passes', () => {
      expect(
        isMilestoneOverdue({ status: 'DELAYED', targetDate: TOMORROW }, NOW),
      ).toBe(true);
    });

    it('is not overdue once completed, even long past the date', () => {
      expect(
        isMilestoneOverdue({ status: 'COMPLETED', targetDate: YESTERDAY }, NOW),
      ).toBe(false);
    });

    it('is not overdue while still ahead of its target', () => {
      expect(
        isMilestoneOverdue(
          { status: 'IN_PROGRESS', targetDate: TOMORROW },
          NOW,
        ),
      ).toBe(false);
    });
  });

  describe('isRiskHighImpactOpen', () => {
    it('qualifies on HIGH impact alone', () => {
      expect(
        isRiskHighImpactOpen({
          status: 'OPEN',
          likelihood: 'LOW',
          impact: 'HIGH',
        }),
      ).toBe(true);
    });

    it('qualifies on HIGH likelihood alone', () => {
      expect(
        isRiskHighImpactOpen({
          status: 'OPEN',
          likelihood: 'HIGH',
          impact: 'LOW',
        }),
      ).toBe(true);
    });

    it('ignores a mid-matrix risk', () => {
      expect(
        isRiskHighImpactOpen({
          status: 'OPEN',
          likelihood: 'MEDIUM',
          impact: 'MEDIUM',
        }),
      ).toBe(false);
    });

    it('ignores a closed or mitigated risk however severe', () => {
      expect(
        isRiskHighImpactOpen({
          status: 'CLOSED',
          likelihood: 'HIGH',
          impact: 'HIGH',
        }),
      ).toBe(false);
      expect(
        isRiskHighImpactOpen({
          status: 'MITIGATED',
          likelihood: 'HIGH',
          impact: 'HIGH',
        }),
      ).toBe(false);
    });
  });
});
