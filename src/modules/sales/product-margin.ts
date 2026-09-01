import { Prisma } from '@prisma/client';

/**
 * The margin every product is expected to earn unless someone sets its own
 * target. A product born out of the RFQ flow gets its cost from the awarded
 * quotes, so without a target the catalog would show a released BOM cost with
 * no sellable price beside it.
 */
export const DEFAULT_TARGET_MARGIN_PERCENT = 20;

export function suggestedSellingPrice(
  cost: Prisma.Decimal | null,
  targetMarginPercent: Prisma.Decimal | null,
): Prisma.Decimal | null {
  if (!cost || targetMarginPercent == null) return null;
  const divisor = new Prisma.Decimal(1).minus(
    targetMarginPercent.dividedBy(100),
  );
  if (divisor.lessThanOrEqualTo(0)) return null;
  return cost
    .dividedBy(divisor)
    .toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
}

/**
 * The cost-plus catalog price for a product whose cost has just been settled by
 * a released BOM. Returns the margin it was priced at too, so a product with no
 * target of its own can be given the default at the same time as its price.
 * Null when there is nothing to price from (no cost, zero cost, or a target so
 * high that no finite price reaches it).
 */
export function catalogPriceFromCost(
  cost: Prisma.Decimal | null,
  targetMarginPercent: Prisma.Decimal | null,
): { unitPrice: Prisma.Decimal; targetMarginPercent: Prisma.Decimal } | null {
  if (!cost || cost.lessThanOrEqualTo(0)) return null;
  const margin =
    targetMarginPercent ?? new Prisma.Decimal(DEFAULT_TARGET_MARGIN_PERCENT);
  const unitPrice = suggestedSellingPrice(cost, margin);
  if (!unitPrice) return null;
  return { unitPrice, targetMarginPercent: margin };
}

export function actualMarginPercent(
  cost: Prisma.Decimal | null,
  sellingPrice: Prisma.Decimal,
): Prisma.Decimal | null {
  if (!cost || sellingPrice.lessThanOrEqualTo(0)) return null;
  return sellingPrice
    .minus(cost)
    .dividedBy(sellingPrice)
    .times(100)
    .toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
}
