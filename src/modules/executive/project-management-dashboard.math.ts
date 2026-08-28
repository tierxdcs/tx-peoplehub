/**
 * Pure arithmetic for the executive PM dashboard.
 *
 * The dashboard's job is comparison — this PM against that PM, this project
 * against the portfolio — so the shapes here are all distributions and shares
 * rather than single totals. Two conventions carry over from the other
 * executive dashboards:
 *
 *  - `null` means "the data cannot answer this", never zero. A PM with no
 *    projects has no on-time percentage; that is not 0%.
 *  - Percentages are fixed-2 strings (the repo's Decimal-on-the-wire habit), so
 *    the page never re-rounds and the two can never disagree.
 */

/** A share of a whole as a fixed-2 string, or null when there is no whole. */
export function ratePercent(part: number, whole: number): string | null {
  if (whole <= 0) return null;
  return ((part / whole) * 100).toFixed(2);
}

/** Plain mean rounded to one decimal, or null for an empty set. */
export function average(values: number[]): number | null {
  if (values.length === 0) return null;
  return (
    Math.round((values.reduce((sum, value) => sum + value, 0) / values.length) *
      10) / 10
  );
}

export type ProjectHealthKey = 'ON_TRACK' | 'AT_RISK' | 'BLOCKED';

export interface HealthCounts {
  onTrack: number;
  atRisk: number;
  blocked: number;
  total: number;
}

export function countHealth(healths: ProjectHealthKey[]): HealthCounts {
  return {
    onTrack: healths.filter((health) => health === 'ON_TRACK').length,
    atRisk: healths.filter((health) => health === 'AT_RISK').length,
    blocked: healths.filter((health) => health === 'BLOCKED').length,
    total: healths.length,
  };
}

/**
 * A PM's load relative to the busiest PM, 0-100.
 *
 * Deliberately relative rather than absolute: there is no company-wide "correct"
 * number of open tasks to measure against, so the only honest comparison is
 * against the current heaviest carrier. 100 always means "this is the most
 * loaded PM right now", which is the redistribution decision the PM Head is
 * actually making. Returns null when nobody carries anything — a flat zero bar
 * would read as "measured and fine" rather than "nothing to compare".
 */
export function relativeLoadPercent(
  value: number,
  peak: number,
): string | null {
  if (peak <= 0) return null;
  return ((value / peak) * 100).toFixed(2);
}

/**
 * How unevenly a total is spread across N carriers, 0-100.
 *
 * 0 = every PM carries exactly the same; 100 = one PM carries everything. This
 * is the normalised mean absolute deviation from an even split, which is the
 * cheapest measure that answers "is this an imbalance or just a big number" —
 * ten PMs each holding 20 tasks is not a redistribution problem, and one PM
 * holding 200 of them is, even though the total is identical.
 *
 * Null for fewer than two carriers: one person cannot be unevenly loaded.
 */
export function imbalancePercent(values: number[]): string | null {
  if (values.length < 2) return null;
  const total = values.reduce((sum, value) => sum + value, 0);
  if (total <= 0) return null;
  const even = total / values.length;
  const deviation =
    values.reduce((sum, value) => sum + Math.abs(value - even), 0) /
    values.length;
  // Maximum possible mean deviation (all on one carrier), used to normalise.
  const worst = (2 * even * (values.length - 1)) / values.length;
  if (worst <= 0) return null;
  return (Math.min(deviation / worst, 1) * 100).toFixed(2);
}

/**
 * Bucket ages in whole days into the fixed ladder the page renders as a bar
 * chart. Open-ended at the top because "stuck for a quarter" and "stuck for a
 * year" call for the same intervention.
 */
export const AGE_BUCKETS = [
  { key: '0-7', label: '≤ 1 week', min: 0, max: 7 },
  { key: '8-30', label: '1-4 weeks', min: 8, max: 30 },
  { key: '31-90', label: '1-3 months', min: 31, max: 90 },
  { key: '90+', label: '> 3 months', min: 91, max: Number.POSITIVE_INFINITY },
] as const;

export interface AgeBucket {
  key: string;
  label: string;
  count: number;
}

export function bucketAges(ages: number[]): AgeBucket[] {
  return AGE_BUCKETS.map((bucket) => ({
    key: bucket.key,
    label: bucket.label,
    count: ages.filter((age) => age >= bucket.min && age <= bucket.max).length,
  }));
}

/**
 * The share of `values` at or beyond `threshold` — used for "what fraction of
 * the queue has already breached the 24h ping boundary" style readings, where
 * the count alone is meaningless without the denominator.
 */
export function breachRate(
  values: number[],
  threshold: number,
): string | null {
  if (values.length === 0) return null;
  return ratePercent(
    values.filter((value) => value >= threshold).length,
    values.length,
  );
}
