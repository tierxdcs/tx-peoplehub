import { describe, expect, it } from 'vitest';
import {
  deliveryCountdownLabel,
  deliveryUrgencyTier,
  rollupDeliveryUrgency,
} from './delivery-urgency';

const line = (daysUntilDue: number | null, id = 'x') => ({
  id,
  promisedDeliveryDate: daysUntilDue === null ? null : '2026-09-01',
  daysUntilDue,
});

describe('deliveryUrgencyTier', () => {
  it('is OVERDUE the day after the promised date', () => {
    expect(deliveryUrgencyTier(-1)).toBe('OVERDUE');
    expect(deliveryUrgencyTier(-40)).toBe('OVERDUE');
  });

  it('treats the promised day itself as urgent, not overdue', () => {
    expect(deliveryUrgencyTier(0)).toBe('URGENT');
  });

  it('holds the two-day and seven-day boundaries the PLM rows use', () => {
    expect(deliveryUrgencyTier(2)).toBe('URGENT');
    expect(deliveryUrgencyTier(3)).toBe('APPROACHING');
    expect(deliveryUrgencyTier(7)).toBe('APPROACHING');
    expect(deliveryUrgencyTier(8)).toBe('ON_TRACK');
  });

  it('is UNCONFIRMED — never ON_TRACK — when no date is promised', () => {
    expect(deliveryUrgencyTier(null)).toBe('UNCONFIRMED');
    expect(deliveryUrgencyTier(undefined)).toBe('UNCONFIRMED');
  });
});

describe('deliveryCountdownLabel', () => {
  it('matches the wording already shown on PLM rows', () => {
    expect(deliveryCountdownLabel(-4)).toBe('4 day(s) overdue');
    expect(deliveryCountdownLabel(0)).toBe('Due today');
    expect(deliveryCountdownLabel(3)).toBe('3 day(s) remaining');
    expect(deliveryCountdownLabel(null)).toBe('Delivery date not confirmed');
  });
});

describe('rollupDeliveryUrgency', () => {
  it('keeps overdue and at-risk disjoint so the two counts can be read together', () => {
    const rollup = rollupDeliveryUrgency([
      line(-3, 'a'),
      line(-1, 'b'),
      line(1, 'c'),
      line(5, 'd'),
      line(30, 'e'),
    ]);
    expect(rollup.overdue).toBe(2);
    expect(rollup.atRisk).toBe(2);
    expect(rollup.onTrack).toBe(1);
    expect(rollup.overdue + rollup.atRisk + rollup.onTrack).toBe(
      rollup.measured,
    );
  });

  it('holds undated lines out of every bucket and reports them', () => {
    const rollup = rollupDeliveryUrgency([line(null, 'a'), line(9, 'b')]);
    expect(rollup.unconfirmed).toBe(1);
    expect(rollup.measured).toBe(1);
    expect(rollup.onTrack).toBe(1);
    expect(rollup.overdue).toBe(0);
    expect(rollup.atRisk).toBe(0);
  });

  it('surfaces the single most-overdue line, deepest overrun first', () => {
    const rollup = rollupDeliveryUrgency([
      line(-3, 'a'),
      line(-19, 'worst'),
      line(-1, 'c'),
    ]);
    expect(rollup.mostOverdue?.id).toBe('worst');
    expect(rollup.overdueLines.map((l) => l.id)).toEqual(['worst', 'a', 'c']);
  });

  it('has no most-overdue line when nothing is late', () => {
    expect(rollupDeliveryUrgency([line(4), line(null)]).mostOverdue).toBeNull();
  });

  it('reports zeroes rather than throwing on an empty portfolio', () => {
    const rollup = rollupDeliveryUrgency([]);
    expect(rollup).toMatchObject({
      measured: 0,
      unconfirmed: 0,
      overdue: 0,
      atRisk: 0,
      onTrack: 0,
      mostOverdue: null,
    });
  });
});
