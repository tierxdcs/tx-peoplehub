import { Prisma } from '@prisma/client';

/**
 * Pure date/arithmetic helpers behind the executive Sales dashboard. Kept out of
 * the service so the fiscal-calendar and averaging rules are unit-testable
 * without a database, and so a future Finance/Production dashboard can reuse the
 * exact same period definition instead of re-deriving one.
 *
 * All ranges are half-open [startsOn, endsBefore) built with Date.UTC, matching
 * the convention already used by the statutory-filings period helpers.
 */

export interface FiscalPeriod {
  /** Display label, e.g. "FY 2026-27". */
  label: string;
  startsOn: Date;
  /** Exclusive upper bound (1 Apr of the following year). */
  endsBefore: Date;
}

export interface MonthBucket {
  /** Sort-stable key, e.g. "2026-04". */
  key: string;
  /** Display label, e.g. "Apr 26". */
  label: string;
  startsOn: Date;
  endsBefore: Date;
}

const MONTH_LABELS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];

/**
 * The Indian fiscal year (1 Apr – 31 Mar) containing `now`. Matches the
 * financial-year derivation the TDS/GST filing service already uses, so
 * "YTD" on this dashboard means the same year as the statutory reports.
 */
export function fiscalYearFor(now: Date): FiscalPeriod {
  const year = now.getUTCMonth() >= 3 ? now.getUTCFullYear() : now.getUTCFullYear() - 1;
  return {
    label: `FY ${year}-${String(year + 1).slice(-2)}`,
    startsOn: new Date(Date.UTC(year, 3, 1)),
    endsBefore: new Date(Date.UTC(year + 1, 3, 1)),
  };
}

/** The fiscal year immediately before `period` — the YoY comparison basis. */
export function previousFiscalYear(period: FiscalPeriod): FiscalPeriod {
  const year = period.startsOn.getUTCFullYear() - 1;
  return {
    label: `FY ${year}-${String(year + 1).slice(-2)}`,
    startsOn: new Date(Date.UTC(year, 3, 1)),
    endsBefore: new Date(Date.UTC(year + 1, 3, 1)),
  };
}

/**
 * The same elapsed slice of `period` that `now` represents in the current year —
 * used so YoY compares April-to-August against April-to-August rather than
 * against a full 12 months, which would always look like a collapse.
 */
export function samePeriodLastYear(
  period: FiscalPeriod,
  now: Date,
): FiscalPeriod {
  const previous = previousFiscalYear(period);
  const elapsedMonths = monthsToDate(period, now).length;
  return {
    ...previous,
    endsBefore: new Date(
      Date.UTC(previous.startsOn.getUTCFullYear(), 3 + elapsedMonths, 1),
    ),
  };
}

/**
 * One bucket per month from the start of `period` up to and including the month
 * containing `now` (never past the period's end). Empty months are kept so a
 * trend line shows the gap honestly instead of compressing it away.
 */
export function monthsToDate(period: FiscalPeriod, now: Date): MonthBucket[] {
  const buckets: MonthBucket[] = [];
  const startYear = period.startsOn.getUTCFullYear();
  for (let offset = 0; offset < 12; offset += 1) {
    const startsOn = new Date(Date.UTC(startYear, 3 + offset, 1));
    if (startsOn >= period.endsBefore) break;
    const endsBefore = new Date(Date.UTC(startYear, 4 + offset, 1));
    buckets.push({
      key: `${startsOn.getUTCFullYear()}-${String(startsOn.getUTCMonth() + 1).padStart(2, '0')}`,
      label: `${MONTH_LABELS[startsOn.getUTCMonth()]} ${String(startsOn.getUTCFullYear()).slice(-2)}`,
      startsOn,
      endsBefore,
    });
    if (now < endsBefore) break;
  }
  return buckets;
}

/** The "YYYY-MM" bucket a timestamp belongs to (UTC), for grouping in memory. */
export function monthKeyOf(date: Date): string {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
}

/** Sum, as a Decimal — never floats, per the repo's money convention. */
export function sumDecimals(values: Prisma.Decimal[]): Prisma.Decimal {
  return values.reduce((total, v) => total.plus(v), new Prisma.Decimal(0));
}

/**
 * Plain mean, or null for an empty set. Null (not zero) is the honest answer
 * when there is nothing to average — the UI renders it as "No data", never 0%.
 */
export function averageDecimal(values: Prisma.Decimal[]): Prisma.Decimal | null {
  if (values.length === 0) return null;
  return sumDecimals(values).dividedBy(values.length);
}

/** Whole days between two instants (floor), used for cycle time and DSO. */
export function daysBetween(from: Date, to: Date): number {
  return Math.floor((to.getTime() - from.getTime()) / 86_400_000);
}

/**
 * Amount-weighted average age in days — the standard DSO shape, so a single
 * large late invoice moves the number more than a small one.
 */
export function weightedAverageDays(
  rows: Array<{ amount: Prisma.Decimal; days: number }>,
): number | null {
  const weight = sumDecimals(rows.map((r) => r.amount));
  if (rows.length === 0 || weight.lte(0)) return null;
  const weighted = rows.reduce(
    (total, r) => total.plus(r.amount.times(r.days)),
    new Prisma.Decimal(0),
  );
  return Math.round(weighted.dividedBy(weight).toNumber());
}

/**
 * Rank contributors by value (descending) and express each as a share of
 * `total`, keeping whatever other fields the caller carried (colour, id, …).
 * Used for both customer concentration and the Business Unit split. Percent is
 * null when the total is zero — a share of nothing is undefined, not 0%.
 */
export function shares<T extends { name: string; value: Prisma.Decimal }>(
  entries: T[],
  total: Prisma.Decimal,
  limit?: number,
): Array<T & { percentOfTotal: Prisma.Decimal | null }> {
  const ranked = [...entries].sort((a, b) => b.value.comparedTo(a.value));
  return (limit === undefined ? ranked : ranked.slice(0, limit)).map((e) => ({
    ...e,
    percentOfTotal: total.gt(0) ? e.value.dividedBy(total).times(100) : null,
  }));
}

/** Decimal → fixed-2 string, or null passthrough (the repo's wire format). */
export function money(value: Prisma.Decimal | null): string | null {
  return value === null ? null : value.toFixed(2);
}

/** Decimal → fixed-2 percent string, or null passthrough. */
export function percent(value: Prisma.Decimal | null): string | null {
  return value === null ? null : value.toFixed(2);
}
