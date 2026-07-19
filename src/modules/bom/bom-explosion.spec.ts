import { Prisma } from '@prisma/client';
import {
  BomCycleError,
  BomDepthError,
  ExplodableBom,
  explodeBom,
} from './bom-explosion';

const D = (n: number | string) => new Prisma.Decimal(n);

/** Build a getReleasedBom lookup from a map of itemId -> lines. */
function lookup(
  boms: Record<string, { rev?: number; lines: Array<[string, number, number?]> }>,
): (itemId: string) => ExplodableBom | null {
  return (itemId: string) => {
    const b = boms[itemId];
    if (!b) return null;
    return {
      itemId,
      revisionNumber: b.rev ?? 1,
      lines: b.lines.map(([childId, qty, wastage]) => ({
        itemId: childId,
        quantityPerUnit: D(qty),
        wastagePercent: D(wastage ?? 0),
        unitOfMeasure: 'ea',
      })),
    };
  };
}

describe('explodeBom — multi-level explosion', () => {
  it('recurses 3+ levels: FG -> SUB -> COMP -> RAW, multiplying quantities', () => {
    // FG needs 2 SUB. SUB needs 3 COMP. COMP needs 4 RAW.
    // RAW per FG unit = 2*3*4 = 24. Only RAW is a leaf (no BOM).
    const get = lookup({
      FG: { lines: [['SUB', 2]] },
      SUB: { lines: [['COMP', 3]] },
      COMP: { lines: [['RAW', 4]] },
    });
    const leaves = explodeBom('FG', get);
    expect(leaves).toHaveLength(1);
    expect(leaves[0].itemId).toBe('RAW');
    expect(leaves[0].quantityPerTopUnit.toString()).toBe('24');
    // Trail reflects the 3 assembly levels traversed to reach the leaf.
    expect(leaves[0].sourceTrail.length).toBeGreaterThanOrEqual(3);
  });

  it('compounds wastage multiplicatively across levels', () => {
    // FG: 1 SUB @10% wastage. SUB: 1 RAW @10% wastage.
    // RAW per FG = 1 * (1*1.1) * (1*1.1) = 1.21
    const get = lookup({
      FG: { lines: [['SUB', 1, 10]] },
      SUB: { lines: [['RAW', 1, 10]] },
    });
    const leaves = explodeBom('FG', get);
    expect(leaves).toHaveLength(1);
    expect(leaves[0].quantityPerTopUnit.toString()).toBe('1.21');
  });

  it('keeps distinct leaves separate (caller aggregates); multiple children explode independently', () => {
    // FG -> [2 SUB, 5 RAW_A]; SUB -> [3 RAW_B]. Leaves: RAW_A(5), RAW_B(6).
    const get = lookup({
      FG: { lines: [['SUB', 2], ['RAW_A', 5]] },
      SUB: { lines: [['RAW_B', 3]] },
    });
    const leaves = explodeBom('FG', get);
    const byId = Object.fromEntries(
      leaves.map((l) => [l.itemId, l.quantityPerTopUnit.toString()]),
    );
    expect(byId).toEqual({ RAW_A: '5', RAW_B: '6' });
  });

  it('treats an item with no BOM (or an empty BOM) as a leaf', () => {
    const get = lookup({ FG: { lines: [['RAW', 7]] } });
    const leaves = explodeBom('FG', get);
    expect(leaves).toEqual([
      expect.objectContaining({ itemId: 'RAW', quantityPerTopUnit: expect.anything() }),
    ]);
    expect(leaves[0].quantityPerTopUnit.toString()).toBe('7');
  });

  it('returns no requirements when the top item itself has no BOM', () => {
    const get = lookup({});
    expect(explodeBom('LONE', get)).toEqual([]);
  });
});

describe('explodeBom — cycle & depth safety', () => {
  it('throws BomCycleError on a direct cycle A -> B -> A (does not hang)', () => {
    const get = lookup({
      A: { lines: [['B', 1]] },
      B: { lines: [['A', 1]] },
    });
    expect(() => explodeBom('A', get)).toThrow(BomCycleError);
  });

  it('throws BomCycleError on a self-referencing BOM A -> A', () => {
    const get = lookup({ A: { lines: [['A', 1]] } });
    expect(() => explodeBom('A', get)).toThrow(BomCycleError);
  });

  it('throws BomCycleError on an indirect cycle A -> B -> C -> A', () => {
    const get = lookup({
      A: { lines: [['B', 1]] },
      B: { lines: [['C', 1]] },
      C: { lines: [['A', 1]] },
    });
    let err: unknown;
    try {
      explodeBom('A', get);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(BomCycleError);
    expect((err as BomCycleError).cyclePath).toContain('A');
  });

  it('enforces a hard depth cap as a backstop against pathological chains', () => {
    // Build a linear chain deeper than MAX_EXPLOSION_DEPTH with no cycle.
    const boms: Record<string, { lines: Array<[string, number]> }> = {};
    for (let i = 0; i < 40; i += 1) {
      boms[`N${i}`] = { lines: [[`N${i + 1}`, 1]] };
    }
    const get = lookup(boms);
    expect(() => explodeBom('N0', get)).toThrow(BomDepthError);
  });
});
