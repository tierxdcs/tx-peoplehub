import { describe, expect, it } from 'vitest';
import {
  ALERT_AFTER_HOURS,
  WARN_AFTER_HOURS,
  checkinTone,
  formatDuration,
} from './checkin-timer';

const HOURS = 3_600_000;

describe('checkinTone', () => {
  it('stays neutral for a normal stretch', () => {
    expect(checkinTone(0)).toBe('idle');
    expect(checkinTone(5.99 * HOURS)).toBe('idle');
  });

  it('warns from exactly six hours', () => {
    expect(checkinTone(WARN_AFTER_HOURS * HOURS)).toBe('warn');
    expect(checkinTone(7.99 * HOURS)).toBe('warn');
  });

  it('escalates from exactly eight hours, and stays there', () => {
    expect(checkinTone(ALERT_AFTER_HOURS * HOURS)).toBe('alert');
    expect(checkinTone(19 * HOURS)).toBe('alert');
  });
});

describe('formatDuration', () => {
  it('reads zero when the clock is not running', () => {
    expect(formatDuration(0)).toBe('0:00:00');
  });

  it('pads minutes and seconds, never the hour', () => {
    expect(formatDuration(9000)).toBe('0:00:09');
    expect(formatDuration(65_000)).toBe('0:01:05');
    expect(formatDuration(6 * HOURS + 7 * 60_000 + 3000)).toBe('6:07:03');
  });

  it('keeps counting past a day rather than wrapping to zero', () => {
    // A forgotten check-out must look obviously wrong, not look like a fresh day.
    expect(formatDuration(26 * HOURS)).toBe('26:00:00');
  });
});
