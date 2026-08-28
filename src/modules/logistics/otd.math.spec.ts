import { delayDays, onTimePercentage } from './otd.math';

const utc = (y: number, m: number, day: number, hour = 0) =>
  new Date(Date.UTC(y, m - 1, day, hour));

describe('delayDays', () => {
  it('is zero when the promise was met exactly', () => {
    expect(delayDays(utc(2026, 8, 20), utc(2026, 8, 20))).toBe(0);
  });

  it('is negative when the delivery arrived early', () => {
    expect(delayDays(utc(2026, 8, 20), utc(2026, 8, 17))).toBe(-3);
  });

  it('rounds a part-day overrun up to a full late day', () => {
    // Promised midnight, arrived the same afternoon: still late, and reported as
    // one day rather than rounded away to on-time.
    expect(delayDays(utc(2026, 8, 20), utc(2026, 8, 20, 14))).toBe(1);
  });

  it('counts whole days late', () => {
    expect(delayDays(utc(2026, 8, 20), utc(2026, 8, 27))).toBe(7);
  });
});

describe('onTimePercentage', () => {
  it('reports one decimal place', () => {
    expect(onTimePercentage(2, 3)).toBe(66.7);
  });

  it('reports 100 when nothing was late', () => {
    expect(onTimePercentage(5, 5)).toBe(100);
  });

  it('reports 0 when everything was late — a real answer, not missing data', () => {
    expect(onTimePercentage(0, 4)).toBe(0);
  });

  it('is null, not 0, when nothing has been delivered', () => {
    expect(onTimePercentage(0, 0)).toBeNull();
  });
});
