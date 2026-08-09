import { Prisma } from '@prisma/client';
import { ExplodedLeaf } from './bom-explosion';

/** Pure release-time roll-up once authoritative leaf costs have been resolved. */
export function rollUpExplodedCost(
  leaves: ExplodedLeaf[],
  costs: ReadonlyMap<string, Prisma.Decimal>,
): Prisma.Decimal {
  return leaves
    .reduce((total, leaf) => {
      const cost = costs.get(leaf.itemId);
      if (!cost) throw new Error(`Missing cost for item ${leaf.itemId}`);
      return total.plus(leaf.quantityPerTopUnit.times(cost));
    }, new Prisma.Decimal(0))
    .toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
}
