import { Prisma } from '@prisma/client';

/**
 * Pure helpers behind the executive SCM dashboard, kept out of the service so the
 * rate/trend rules are unit-testable without a database.
 *
 * Nothing here duplicates an existing calculation. The fiscal calendar, money and
 * percent wire formats, share ranking and `daysBetween` come from
 * sales-dashboard.math.ts; `averageNumber` and `premiumOverLowest` come from
 * operations-dashboard.math.ts. Only the genuinely new shapes live here:
 * participation/response rates, monthly averaging, and trend direction.
 */

/**
 * A share of a whole as a percentage, or null when the whole is zero. Null (not
 * 0%) is the honest answer for "of nothing" — 0% would read as "nobody
 * responded" when the truth is "nobody was asked".
 */
export function ratePercent(
  part: number,
  whole: number,
): Prisma.Decimal | null {
  if (whole <= 0) return null;
  return new Prisma.Decimal(part).dividedBy(whole).times(100);
}

/**
 * Which way a series of monthly averages is heading, comparing the mean of the
 * first half of the MEASURED months against the mean of the second half. Halves
 * rather than first-vs-last point, so one quiet month does not flip the verdict.
 *
 * `null` when fewer than two months carry a value — a single point has no
 * direction, and calling it FLAT would overstate what we know.
 *
 * Direction is stated in raw terms (RISING / FALLING), never as good or bad: a
 * rising lead time is bad while a rising participation rate is good, so the
 * caller applies the meaning.
 */
export type TrendDirection = 'RISING' | 'FALLING' | 'FLAT';

export function trendDirection(
  values: Array<number | null>,
): TrendDirection | null {
  const measured = values.filter((value): value is number => value !== null);
  if (measured.length < 2) return null;
  const mid = Math.ceil(measured.length / 2);
  const mean = (slice: number[]) =>
    slice.reduce((sum, value) => sum + value, 0) / slice.length;
  const first = mean(measured.slice(0, mid));
  const second = mean(measured.slice(mid));
  // A move under 5% of the earlier mean is noise, not a trend.
  const threshold = Math.abs(first) * 0.05;
  if (Math.abs(second - first) <= threshold) return 'FLAT';
  return second > first ? 'RISING' : 'FALLING';
}

/**
 * Mean of the values falling in each bucket, keyed by that bucket. Empty buckets
 * map to null so a trend line breaks over a month with no activity instead of
 * being drawn through zero, which would invent a collapse that never happened.
 */
export function monthlyAverage(
  rows: Array<{ monthKey: string; value: number }>,
  bucketKeys: string[],
): Array<{ key: string; value: number | null }> {
  const byKey = new Map<string, number[]>();
  for (const row of rows) {
    const list = byKey.get(row.monthKey) ?? [];
    list.push(row.value);
    byKey.set(row.monthKey, list);
  }
  return bucketKeys.map((key) => {
    const values = byKey.get(key) ?? [];
    return {
      key,
      value: values.length
        ? Math.round(
            (values.reduce((sum, value) => sum + value, 0) / values.length) * 10,
          ) / 10
        : null,
    };
  });
}

/**
 * Count of values per bucket. Unlike an average, zero IS the right answer for an
 * empty month here: "no NCR was raised in July" is a fact, not missing data.
 */
export function monthlyCount(
  monthKeys: string[],
  bucketKeys: string[],
): Array<{ key: string; value: number }> {
  const counts = new Map<string, number>();
  for (const key of monthKeys) {
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return bucketKeys.map((key) => ({ key, value: counts.get(key) ?? 0 }));
}

/**
 * Whether the awarded total is the lowest of the totals received, using the same
 * exact-Decimal equality the award gate itself uses (RfqService.award) so this
 * dashboard can never disagree with whether a justification was required.
 *
 * Returns null when there is nothing to compare against.
 */
export function awardWasLowest(
  awardedTotal: Prisma.Decimal,
  submittedTotals: Prisma.Decimal[],
): boolean | null {
  if (submittedTotals.length === 0) return null;
  const lowest = submittedTotals.reduce((min, total) =>
    total.lessThan(min) ? total : min,
  );
  return awardedTotal.equals(lowest);
}
