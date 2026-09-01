import { describe, expect, it } from 'vitest';
import {
  confirmedProductionSteps,
  plmTrackerHref,
  stageStripProgress,
} from './plm';

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

describe('stageStripProgress', () => {
  it('ticks the final node once the tracker is COMPLETED, with nothing current', () => {
    const strip = stageStripProgress({
      flowType: 'VENDOR',
      currentStage: 'COMPLETED',
    });
    expect(strip.doneThrough).toBe(strip.stages.length);
    expect(strip.activeIndex).toBe(-1);
  });

  it('does the same on the longer NPD flow', () => {
    const strip = stageStripProgress({
      flowType: 'NPD',
      currentStage: 'COMPLETED',
    });
    expect(strip.stages).toHaveLength(9);
    expect(strip.doneThrough).toBe(9);
    expect(strip.activeIndex).toBe(-1);
  });

  it('leaves the live stage highlighted and unticked mid-flow', () => {
    expect(
      stageStripProgress({ flowType: 'IN_HOUSE', currentStage: 'QC' }),
    ).toMatchObject({ doneThrough: 3, activeIndex: 3 });
  });

  it('ticks nothing at the very first stage', () => {
    expect(
      stageStripProgress({
        flowType: 'VENDOR',
        currentStage: 'RELEASE_TO_SCM',
      }),
    ).toMatchObject({ doneThrough: 0, activeIndex: 0 });
  });

  it('highlights nothing for a stage outside the flow', () => {
    expect(
      stageStripProgress({ flowType: 'VENDOR', currentStage: 'DESIGN' }),
    ).toMatchObject({ doneThrough: 0, activeIndex: -1 });
  });
});
