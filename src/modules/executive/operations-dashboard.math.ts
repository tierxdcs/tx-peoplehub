import { Prisma } from '@prisma/client';

/**
 * Pure helpers behind the executive Operations dashboard, kept out of the service
 * so the segmentation and averaging rules are unit-testable without a database.
 *
 * Period arithmetic, money/percent formatting and share ranking are NOT here —
 * those already exist in sales-dashboard.math.ts and are imported from there, so
 * both executive dashboards share one fiscal calendar and one wire format.
 */

/**
 * Which facility segment a delivery challan belongs to, given the delivery types
 * of every split behind every line dispatched on it.
 *
 * OTD is a per-challan measurement (one promise, one arrival), but a challan can
 * carry work from more than one facility. A MIXED challan is reported as mixed
 * and left out of both segments rather than credited to either — attributing a
 * late shipment to a facility that only supplied part of it would be a guess.
 */
export type DispatchFacilitySegment =
  'IN_HOUSE' | 'OTHER' | 'MIXED' | 'UNCLASSIFIED';

export function dispatchFacilitySegment(
  deliveryTypes: Array<string | null>,
): DispatchFacilitySegment {
  const classified = deliveryTypes.filter((type): type is string => !!type);
  if (classified.length === 0) return 'UNCLASSIFIED';
  const inHouse = classified.filter((type) => type === 'IN_HOUSE').length;
  if (inHouse === classified.length) return 'IN_HOUSE';
  if (inHouse === 0) return 'OTHER';
  return 'MIXED';
}

/**
 * Plain mean to one decimal, or null for an empty set — the same "null means the
 * data cannot answer this" convention the rest of the executive section uses.
 */
export function averageNumber(values: number[]): number | null {
  if (values.length === 0) return null;
  const total = values.reduce((sum, value) => sum + value, 0);
  return Math.round((total / values.length) * 10) / 10;
}

/**
 * Whole-percent completion, matching `deriveProductionProgress`'s rounding so a
 * rollup agrees with the per-tracker figures it is built from. Null (not 0) when
 * there are no cards at all: no board is "0% done", it is unmeasured.
 */
export function completionPercent(done: number, total: number): number | null {
  return total === 0 ? null : Math.round((done / total) * 100);
}

/**
 * What the awarded quote cost over the lowest quote received. Same shape as the
 * RFQ comparison table's variance-vs-lowest column (rfq.service.ts): absolute
 * difference, and a percentage only when the lowest total is positive.
 *
 * Zero is a real, meaningful answer here — it means the lowest quote won.
 */
export function premiumOverLowest(
  awardedTotal: Prisma.Decimal,
  lowestTotal: Prisma.Decimal,
): { amount: Prisma.Decimal; percent: Prisma.Decimal | null } {
  const amount = awardedTotal.minus(lowestTotal);
  return {
    amount,
    percent: lowestTotal.greaterThan(0)
      ? amount.dividedBy(lowestTotal).times(100)
      : null,
  };
}
