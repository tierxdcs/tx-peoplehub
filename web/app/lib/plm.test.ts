import { describe, expect, it } from 'vitest';
import { confirmedProductionSteps, plmTrackerHref } from './plm';

describe('plmTrackerHref', () => {
  it('opens a tracker through the PLM-authorized route, not the Sales order route', () => {
    expect(plmTrackerHref('tracker-1')).toBe('/plm/trackers/tracker-1');
    expect(plmTrackerHref('tracker/unsafe')).toBe(
      '/plm/trackers/tracker%2Funsafe',
    );
  });
});

describe('confirmedProductionSteps', () => {
  it('uses the furthest saved full-progress update', () => {
    expect(
      confirmedProductionSteps([
        { completedSteps: null },
        { completedSteps: 3 },
        { completedSteps: 5 },
        { completedSteps: 4 },
      ]),
    ).toBe(5);
  });

  it('defaults legacy/comment-only history to not started', () => {
    expect(confirmedProductionSteps([{ completedSteps: null }])).toBe(0);
  });

  it('keeps the displayed value within the routing bounds', () => {
    expect(confirmedProductionSteps([{ completedSteps: 99 }])).toBe(9);
    expect(confirmedProductionSteps([{ completedSteps: -1 }])).toBe(0);
  });
});
