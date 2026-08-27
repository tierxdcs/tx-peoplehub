import { Prisma } from '@prisma/client';
import {
  averageDecimal,
  daysBetween,
  fiscalYearFor,
  monthKeyOf,
  monthsToDate,
  previousFiscalYear,
  samePeriodLastYear,
  shares,
  sumDecimals,
  weightedAverageDays,
} from './sales-dashboard.math';

const d = (n: string | number) => new Prisma.Decimal(n);
const utc = (y: number, m: number, day = 1) =>
  new Date(Date.UTC(y, m - 1, day));

describe('fiscalYearFor', () => {
  it('puts April onwards in the year that starts that April', () => {
    const fy = fiscalYearFor(utc(2026, 8, 25));
    expect(fy.label).toBe('FY 2026-27');
    expect(fy.startsOn.toISOString()).toBe('2026-04-01T00:00:00.000Z');
    expect(fy.endsBefore.toISOString()).toBe('2027-04-01T00:00:00.000Z');
  });

  it('puts Jan–Mar in the year that started the previous April', () => {
    expect(fiscalYearFor(utc(2026, 2, 14)).label).toBe('FY 2025-26');
  });

  it('treats 1 April as the first day of the new year, not the last of the old', () => {
    expect(fiscalYearFor(utc(2026, 4, 1)).label).toBe('FY 2026-27');
    expect(fiscalYearFor(utc(2026, 3, 31)).label).toBe('FY 2025-26');
  });
});

describe('previousFiscalYear', () => {
  it('steps back exactly one April-to-April window', () => {
    const prior = previousFiscalYear(fiscalYearFor(utc(2026, 8, 25)));
    expect(prior.label).toBe('FY 2025-26');
    expect(prior.startsOn.toISOString()).toBe('2025-04-01T00:00:00.000Z');
    expect(prior.endsBefore.toISOString()).toBe('2026-04-01T00:00:00.000Z');
  });
});

describe('samePeriodLastYear', () => {
  it('truncates the prior year to the same number of elapsed months', () => {
    // 25 Aug 2026 = 5 elapsed months (Apr–Aug), so the comparison window is
    // 1 Apr 2025 – 1 Sep 2025, not the whole prior year.
    const window = samePeriodLastYear(
      fiscalYearFor(utc(2026, 8, 25)),
      utc(2026, 8, 25),
    );
    expect(window.startsOn.toISOString()).toBe('2025-04-01T00:00:00.000Z');
    expect(window.endsBefore.toISOString()).toBe('2025-09-01T00:00:00.000Z');
  });

  it('covers the full prior year once the current year is complete', () => {
    const window = samePeriodLastYear(
      fiscalYearFor(utc(2027, 3, 31)),
      utc(2027, 3, 31),
    );
    expect(window.endsBefore.toISOString()).toBe('2026-04-01T00:00:00.000Z');
  });
});

describe('monthsToDate', () => {
  it('runs from April to the month containing now, inclusive', () => {
    const buckets = monthsToDate(
      fiscalYearFor(utc(2026, 8, 25)),
      utc(2026, 8, 25),
    );
    expect(buckets.map((b) => b.key)).toEqual([
      '2026-04',
      '2026-05',
      '2026-06',
      '2026-07',
      '2026-08',
    ]);
    expect(buckets[0].label).toBe('Apr 26');
    expect(buckets[4].label).toBe('Aug 26');
  });

  it('never runs past March of the closing year', () => {
    const buckets = monthsToDate(
      fiscalYearFor(utc(2027, 3, 31)),
      utc(2027, 3, 31),
    );
    expect(buckets).toHaveLength(12);
    expect(buckets[11].key).toBe('2027-03');
  });

  it('yields a single bucket in the first month of the year', () => {
    expect(
      monthsToDate(fiscalYearFor(utc(2026, 4, 2)), utc(2026, 4, 2)),
    ).toHaveLength(1);
  });

  it('gives each bucket a half-open range that matches monthKeyOf', () => {
    const [april] = monthsToDate(
      fiscalYearFor(utc(2026, 4, 2)),
      utc(2026, 4, 2),
    );
    expect(monthKeyOf(april.startsOn)).toBe('2026-04');
    expect(monthKeyOf(new Date(april.endsBefore.getTime() - 1))).toBe(
      '2026-04',
    );
    expect(monthKeyOf(april.endsBefore)).toBe('2026-05');
  });
});

describe('sumDecimals / averageDecimal', () => {
  it('sums without float drift', () => {
    expect(sumDecimals([d('0.1'), d('0.2')]).toFixed(2)).toBe('0.30');
  });

  it('returns null rather than zero for an empty average', () => {
    // The dashboard renders null as "No data"; a 0 would read as a real 0% margin.
    expect(averageDecimal([])).toBeNull();
  });

  it('averages plainly across the set', () => {
    expect(averageDecimal([d(10), d(20), d(30)])!.toFixed(2)).toBe('20.00');
  });
});

describe('daysBetween', () => {
  it('counts whole elapsed days', () => {
    expect(daysBetween(utc(2026, 4, 1), utc(2026, 4, 11))).toBe(10);
  });

  it('floors a partial day', () => {
    expect(
      daysBetween(
        new Date(Date.UTC(2026, 3, 1, 23)),
        new Date(Date.UTC(2026, 3, 2, 1)),
      ),
    ).toBe(0);
  });
});

describe('weightedAverageDays', () => {
  it('weights by amount, not by row count', () => {
    // 900 paid at 10 days, 100 paid at 100 days -> 19, not the unweighted 55.
    expect(
      weightedAverageDays([
        { amount: d(900), days: 10 },
        { amount: d(100), days: 100 },
      ]),
    ).toBe(19);
  });

  it('is null with nothing to measure', () => {
    expect(weightedAverageDays([])).toBeNull();
  });

  it('is null when the weights sum to zero instead of dividing by zero', () => {
    expect(weightedAverageDays([{ amount: d(0), days: 40 }])).toBeNull();
  });
});

describe('shares', () => {
  const entries = [
    { name: 'A', value: d(500) },
    { name: 'B', value: d(300) },
    { name: 'C', value: d(200) },
  ];

  it('ranks descending and computes percent of total', () => {
    const result = shares(entries, d(1000));
    expect(result.map((r) => r.name)).toEqual(['A', 'B', 'C']);
    expect(result[0].percentOfTotal!.toFixed(2)).toBe('50.00');
  });

  it('applies the top-N limit after ranking', () => {
    expect(shares(entries, d(1000), 2).map((r) => r.name)).toEqual(['A', 'B']);
  });

  it('reports null percent against a zero total', () => {
    expect(
      shares([{ name: 'A', value: d(0) }], d(0))[0].percentOfTotal,
    ).toBeNull();
  });

  it('carries extra fields through so a slice keeps its colour', () => {
    const result = shares(
      [{ name: 'A', value: d(1), colorHex: '#111111' }],
      d(1),
    );
    expect(result[0].colorHex).toBe('#111111');
  });
});
