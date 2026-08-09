import { Prisma } from '@prisma/client';

export function suggestedSellingPrice(
  cost: Prisma.Decimal | null,
  targetMarginPercent: Prisma.Decimal | null,
): Prisma.Decimal | null {
  if (!cost || targetMarginPercent == null) return null;
  const divisor = new Prisma.Decimal(1).minus(targetMarginPercent.dividedBy(100));
  if (divisor.lessThanOrEqualTo(0)) return null;
  return cost.dividedBy(divisor).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
}

export function actualMarginPercent(
  cost: Prisma.Decimal | null,
  sellingPrice: Prisma.Decimal,
): Prisma.Decimal | null {
  if (!cost || sellingPrice.lessThanOrEqualTo(0)) return null;
  return sellingPrice.minus(cost).dividedBy(sellingPrice).times(100)
    .toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
}
