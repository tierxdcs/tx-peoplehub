import { Prisma } from '@prisma/client';
import { round } from './stock-calc';

/**
 * Pure multi-level BOM explosion. Kept free of Prisma queries so it is directly
 * unit-testable: the caller supplies a `getReleasedBom(itemId)` lookup (which in
 * production hits the DB) and this walks the tree.
 *
 * A BOM is keyed on an Item. A line references a child Item; if that child has
 * its OWN released BOM, we recurse into it (multiplying quantities), otherwise
 * the child is a LEAF requirement (raw material / bought component / anything
 * with no further BOM). Wastage compounds at each level.
 *
 * Cycle detection: the ancestor item path is tracked; revisiting an item already
 * on the path throws BomCycleError (never hangs). A hard depth cap is a second
 * backstop against pathological trees.
 */

export const MAX_EXPLOSION_DEPTH = 25;

export class BomCycleError extends Error {
  constructor(public readonly cyclePath: string[]) {
    super(`BOM cycle detected: ${cyclePath.join(' -> ')}`);
    this.name = 'BomCycleError';
  }
}

export class BomDepthError extends Error {
  constructor(public readonly path: string[]) {
    super(
      `BOM explosion exceeded the maximum depth of ${MAX_EXPLOSION_DEPTH}: ${path.join(
        ' -> ',
      )}`,
    );
    this.name = 'BomDepthError';
  }
}

/** One line of a released BOM, as the explosion needs it. */
export interface ExplodableLine {
  itemId: string;
  quantityPerUnit: Prisma.Decimal;
  wastagePercent: Prisma.Decimal;
  unitOfMeasure: string;
}

/** The released BOM for an item (only the fields explosion needs). */
export interface ExplodableBom {
  itemId: string;
  revisionNumber: number;
  lines: ExplodableLine[];
}

/** A leaf requirement produced by the explosion (no further BOM to expand). */
export interface ExplodedLeaf {
  itemId: string;
  unitOfMeasure: string;
  /**
   * Quantity of this leaf per ONE top unit WITH wastage folded in (compounded
   * across every level). This is the gross requirement driver.
   */
  quantityPerTopUnit: Prisma.Decimal;
  /**
   * Quantity of this leaf per ONE top unit WITHOUT any wastage (pure product of
   * the per-level quantities). Lets the report show an honest base + an
   * effective compounded wastage % = (gross/base − 1)·100.
   */
  basePerTopUnit: Prisma.Decimal;
  /** Deepest revision-source trail, e.g. ["FG Rev 2", "SUB Rev 1"]. */
  sourceTrail: string[];
}

/**
 * Explode the released BOM for `topItemId` into leaf requirements, each
 * expressed per ONE unit of the top item. `getReleasedBom` returns the released
 * BOM for an item or null (→ that item is a leaf).
 *
 * `multiplier` is the accumulated quantity-per-top-unit down the current branch
 * (starts at 1). Wastage is applied multiplicatively at each level a parent
 * consumes a child, so a 10% wastage two levels down compounds correctly.
 */
export function explodeBom(
  topItemId: string,
  getReleasedBom: (itemId: string) => ExplodableBom | null,
): ExplodedLeaf[] {
  const leaves: ExplodedLeaf[] = [];

  const walk = (
    itemId: string,
    grossMultiplier: Prisma.Decimal,
    baseMultiplier: Prisma.Decimal,
    ancestors: string[],
    trail: string[],
  ): void => {
    if (ancestors.includes(itemId)) {
      throw new BomCycleError([...ancestors, itemId]);
    }
    if (ancestors.length >= MAX_EXPLOSION_DEPTH) {
      throw new BomDepthError([...ancestors, itemId]);
    }
    const bom = getReleasedBom(itemId);
    if (!bom || bom.lines.length === 0) {
      // Leaf: no further BOM (or an empty BOM). It contributes itself.
      // (The top item is expected to have a BOM; if it doesn't, there are no
      //  requirements — the caller decides whether that's an error.)
      return;
    }
    const nextAncestors = [...ancestors, itemId];
    for (const line of bom.lines) {
      // With-wastage multiplier folds in this level's wastage; base does not.
      const wastageFactor = new Prisma.Decimal(1).plus(
        line.wastagePercent.dividedBy(100),
      );
      const childGross = round(
        grossMultiplier.times(line.quantityPerUnit).times(wastageFactor),
      );
      const childBase = round(baseMultiplier.times(line.quantityPerUnit));
      const childTrail = [...trail, `${bom.revisionNumber}`];
      const childBom = getReleasedBom(line.itemId);
      if (childBom && childBom.lines.length > 0) {
        // Intermediate assembly — recurse; it does not itself become a leaf.
        walk(line.itemId, childGross, childBase, nextAncestors, childTrail);
      } else {
        // Leaf requirement — accumulate (same leaf reached via multiple paths
        // is merged by the caller; here we just push each occurrence).
        leaves.push({
          itemId: line.itemId,
          unitOfMeasure: line.unitOfMeasure,
          quantityPerTopUnit: childGross,
          basePerTopUnit: childBase,
          sourceTrail: childTrail,
        });
      }
    }
  };

  const one = new Prisma.Decimal(1);
  walk(topItemId, one, one, [], [`${getReleasedBom(topItemId)?.revisionNumber ?? 0}`]);
  return leaves;
}
