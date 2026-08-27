import { describe, expect, it } from 'vitest';
import {
  AGING_AFTER_HOURS,
  STALE_AFTER_HOURS,
  URGENCY_BADGE_VARIANT,
  URGENCY_PULSE_CLASS,
  ageHours,
  queueTier,
  urgencyTier,
  waitingLabel,
} from './urgency';

const NOW = new Date('2026-03-10T12:00:00.000Z');

/** `hours` before NOW, as the ISO string an API payload would carry. */
function hoursAgo(hours: number): string {
  return new Date(NOW.getTime() - hours * 3_600_000).toISOString();
}

describe('ageHours', () => {
  it('floors to whole elapsed hours', () => {
    expect(ageHours(hoursAgo(0), NOW)).toBe(0);
    expect(ageHours(new Date(NOW.getTime() - 59 * 60_000), NOW)).toBe(0);
    expect(ageHours(hoursAgo(1), NOW)).toBe(1);
    expect(ageHours(hoursAgo(47.9), NOW)).toBe(47);
  });

  it('never reports negative age for a future stamp', () => {
    expect(ageHours(new Date(NOW.getTime() + 5 * 3_600_000), NOW)).toBe(0);
  });

  it('accepts a Date as well as an ISO string', () => {
    expect(ageHours(new Date(NOW.getTime() - 3 * 3_600_000), NOW)).toBe(3);
  });
});

describe('urgencyTier', () => {
  it('is anchored to the Pings escalation boundary', () => {
    expect(AGING_AFTER_HOURS).toBe(24);
    expect(STALE_AFTER_HOURS).toBe(72);
  });

  it('switches tier exactly at the thresholds (inclusive)', () => {
    expect(urgencyTier(0)).toBe('ok');
    expect(urgencyTier(AGING_AFTER_HOURS - 1)).toBe('ok');
    expect(urgencyTier(AGING_AFTER_HOURS)).toBe('aging');
    expect(urgencyTier(STALE_AFTER_HOURS - 1)).toBe('aging');
    expect(urgencyTier(STALE_AFTER_HOURS)).toBe('stale');
    expect(urgencyTier(1_000)).toBe('stale');
  });
});

describe('queueTier', () => {
  it('maps a waiting-since stamp onto the shared tiers', () => {
    expect(queueTier(hoursAgo(2), NOW)).toBe('ok');
    expect(queueTier(hoursAgo(30), NOW)).toBe('aging');
    expect(queueTier(hoursAgo(100), NOW)).toBe('stale');
  });

  it('treats a missing stamp as not urgent — never invents urgency', () => {
    expect(queueTier(null, NOW)).toBe('ok');
    expect(queueTier(undefined, NOW)).toBe('ok');
  });
});

describe('tier presentation', () => {
  it('reuses the design system badge variants', () => {
    expect(URGENCY_BADGE_VARIANT).toEqual({
      ok: 'muted',
      aging: 'warning',
      stale: 'destructive',
    });
  });

  it('pulses only in the stale tier', () => {
    expect(URGENCY_PULSE_CLASS.ok).toBe('');
    expect(URGENCY_PULSE_CLASS.aging).toBe('');
    expect(URGENCY_PULSE_CLASS.stale).toBe('badge-stale');
  });
});

describe('waitingLabel', () => {
  it('reads naturally across the scale', () => {
    expect(waitingLabel(0)).toBe('waiting under an hour');
    expect(waitingLabel(1)).toBe('waiting 1 hour');
    expect(waitingLabel(5)).toBe('waiting 5 hours');
    expect(waitingLabel(24)).toBe('waiting 1 day');
    expect(waitingLabel(75)).toBe('waiting 3 days');
  });
});
