/**
 * The one delivery-date urgency scale in the product. The PLM tracker workspace
 * established it per row; the Executive Operations dashboard rolls the same
 * verdicts up company-wide. Both import from here so a line that reads "3 days
 * overdue" on the tracker can never be counted as On Track on the dashboard.
 *
 * The tiering is driven entirely by `daysUntilDue`, which the backend already
 * computes in whole UTC days from the confirmation sheet's promised delivery
 * date — no second date arithmetic here, and therefore no timezone drift
 * between the row and the rollup.
 */

export type DeliveryUrgencyTier =
  /** Past its promised delivery date. */
  | 'OVERDUE'
  /** Due today or within two days. */
  | 'URGENT'
  /** Due within a week. */
  | 'APPROACHING'
  /** More than a week out. */
  | 'ON_TRACK'
  /** No promised delivery date is on the confirmation sheet yet. */
  | 'UNCONFIRMED';

/** Due within this many days counts as urgent (red). */
export const URGENT_WITHIN_DAYS = 2;
/** Due within this many days counts as approaching (amber). */
export const APPROACHING_WITHIN_DAYS = 7;

export function deliveryUrgencyTier(
  daysUntilDue: number | null | undefined,
): DeliveryUrgencyTier {
  if (daysUntilDue == null) return 'UNCONFIRMED';
  if (daysUntilDue < 0) return 'OVERDUE';
  if (daysUntilDue <= URGENT_WITHIN_DAYS) return 'URGENT';
  if (daysUntilDue <= APPROACHING_WITHIN_DAYS) return 'APPROACHING';
  return 'ON_TRACK';
}

/** Tailwind text colour per tier — the treatment already used on PLM rows. */
export const DELIVERY_URGENCY_TEXT_CLASS: Record<DeliveryUrgencyTier, string> = {
  OVERDUE: 'text-destructive',
  URGENT: 'text-destructive',
  APPROACHING: 'text-warning-foreground',
  ON_TRACK: 'text-success',
  UNCONFIRMED: 'text-muted-foreground',
};

/**
 * "4 day(s) overdue" / "Due today" / "3 day(s) remaining" — the wording the PLM
 * tracker page already shows, so the two views read identically.
 */
export function deliveryCountdownLabel(
  daysUntilDue: number | null | undefined,
): string {
  if (daysUntilDue == null) return 'Delivery date not confirmed';
  if (daysUntilDue < 0) return `${Math.abs(daysUntilDue)} day(s) overdue`;
  if (daysUntilDue === 0) return 'Due today';
  return `${daysUntilDue} day(s) remaining`;
}

/** Minimum a line must carry to be tiered — any PLM dashboard row satisfies it. */
export interface DeliveryUrgencyLine {
  promisedDeliveryDate: string | null;
  daysUntilDue: number | null;
}

export interface DeliveryUrgencyRollup<T extends DeliveryUrgencyLine> {
  /** Lines with a promised date, i.e. everything the rollup could judge. */
  measured: number;
  /** Lines with no promised delivery date — reported, never counted as fine. */
  unconfirmed: number;
  overdue: number;
  /** OVERDUE + URGENT + APPROACHING: everything not comfortably clear. */
  atRisk: number;
  onTrack: number;
  /** Overdue lines, deepest overrun first. */
  overdueLines: T[];
  /** The single worst line — the one the dashboard leads with. */
  mostOverdue: T | null;
}

/**
 * Roll a set of order lines up into On Track / At Risk / Overdue.
 *
 * At Risk deliberately includes URGENT and APPROACHING but not OVERDUE-only
 * counting: a COO reading "12 at risk, 3 overdue" needs the two numbers to be
 * disjoint, so `atRisk` here excludes the overdue lines and `overdue` stands on
 * its own. Unconfirmed lines are held out of both rather than assumed fine.
 */
export function rollupDeliveryUrgency<T extends DeliveryUrgencyLine>(
  lines: T[],
): DeliveryUrgencyRollup<T> {
  const tiered = lines.map((line) => ({
    line,
    tier: deliveryUrgencyTier(line.daysUntilDue),
  }));
  const of = (...tiers: DeliveryUrgencyTier[]) =>
    tiered.filter((entry) => tiers.includes(entry.tier));
  const overdueLines = of('OVERDUE')
    .map((entry) => entry.line)
    .sort((left, right) => (left.daysUntilDue ?? 0) - (right.daysUntilDue ?? 0));
  return {
    measured: lines.length - of('UNCONFIRMED').length,
    unconfirmed: of('UNCONFIRMED').length,
    overdue: overdueLines.length,
    atRisk: of('URGENT', 'APPROACHING').length,
    onTrack: of('ON_TRACK').length,
    overdueLines,
    mostOverdue: overdueLines[0] ?? null,
  };
}
