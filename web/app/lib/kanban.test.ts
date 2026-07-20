import { describe, expect, it } from 'vitest';
import { positionForIndex } from './kanban';

describe('Kanban modal move positioning', () => {
  it('appends to an empty target list', () => {
    expect(positionForIndex([], 0)).toBeGreaterThan(0);
  });

  it('appends after the final card in the target list', () => {
    const positions = [1024, 2048, 3072];
    expect(positionForIndex(positions, positions.length)).toBeGreaterThan(3072);
  });
});
