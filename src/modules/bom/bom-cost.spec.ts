import { Prisma } from '@prisma/client';
import { explodeBom, type ExplodableBom } from './bom-explosion';
import { rollUpExplodedCost } from './bom-cost';

const d = (value: number) => new Prisma.Decimal(value);

describe('BOM cost roll-up', () => {
  it('rolls a three-level BOM to leaf cost', () => {
    const boms = new Map<string, ExplodableBom>([
      ['finished', { itemId: 'finished', revisionNumber: 1, lines: [{ itemId: 'assembly', quantityPerUnit: d(2), wastagePercent: d(0), unitOfMeasure: 'pcs' }] }],
      ['assembly', { itemId: 'assembly', revisionNumber: 1, lines: [{ itemId: 'subassembly', quantityPerUnit: d(3), wastagePercent: d(0), unitOfMeasure: 'pcs' }] }],
      ['subassembly', { itemId: 'subassembly', revisionNumber: 1, lines: [{ itemId: 'material', quantityPerUnit: d(4), wastagePercent: d(0), unitOfMeasure: 'kg' }] }],
    ]);
    const leaves = explodeBom('finished', (id) => boms.get(id) ?? null);

    expect(
      rollUpExplodedCost(leaves, new Map([['material', d(10)]])).toString(),
    ).toBe('240');
  });
});
