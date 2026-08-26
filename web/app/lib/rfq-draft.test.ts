import { describe, expect, it } from 'vitest';
import {
  blankLineDraft,
  lineSignature,
  toDateTimeInput,
  toLineDraft,
} from './rfq-draft';
import type { RfqLine } from './rfq';

function line(overrides: Partial<RfqLine> = {}): RfqLine {
  return {
    id: 'line-1',
    itemId: 'item-a',
    itemCode: 'IT-A',
    itemName: 'Item A',
    quantity: '10.0000',
    unitOfMeasure: 'ea',
    specificationNotes: null,
    targetPrice: null,
    sequence: 0,
    ...overrides,
  };
}

describe('toLineDraft', () => {
  it('turns the API shape into editable strings, nulls becoming blank', () => {
    const draft = toLineDraft(line());
    expect(draft).toMatchObject({
      itemId: 'item-a',
      quantity: '10.0000',
      unitOfMeasure: 'ea',
      targetPrice: '',
      specificationNotes: '',
    });
  });

  it('hands out a distinct key per draft row', () => {
    const keys = [
      toLineDraft(line()).key,
      toLineDraft(line()).key,
      blankLineDraft().key,
    ];
    expect(new Set(keys).size).toBe(3);
  });
});

describe('lineSignature', () => {
  const original = [line(), line({ id: 'line-2', itemId: 'item-b' })].map(
    toLineDraft,
  );

  it('reads a round-trip of the persisted lines as unchanged', () => {
    // The whole point: a title-only save must not ship `lines`, because the
    // server clears the PM approval whenever the sourcing scope moves.
    const roundTripped = [line(), line({ id: 'line-2', itemId: 'item-b' })].map(
      toLineDraft,
    );
    expect(lineSignature(roundTripped)).toBe(lineSignature(original));
  });

  it('ignores trailing-zero differences in quantity and price', () => {
    const retyped = [
      toLineDraft(line({ quantity: '10' })),
      toLineDraft(line({ id: 'line-2', itemId: 'item-b', quantity: '10.00' })),
    ];
    expect(lineSignature(retyped)).toBe(lineSignature(original));
  });

  it('notices a changed quantity, price, item, note or order', () => {
    const changed = [
      [toLineDraft(line({ quantity: '12' })), original[1]],
      [toLineDraft(line({ targetPrice: '99.50' })), original[1]],
      [toLineDraft(line({ itemId: 'item-z' })), original[1]],
      [toLineDraft(line({ specificationNotes: 'IP65' })), original[1]],
      [original[1], original[0]],
    ];
    for (const lines of changed) {
      expect(lineSignature(lines)).not.toBe(lineSignature(original));
    }
  });

  it('notices a dropped or added line', () => {
    expect(lineSignature([original[0]])).not.toBe(lineSignature(original));
    expect(lineSignature([...original, blankLineDraft()])).not.toBe(
      lineSignature(original),
    );
  });

  it('treats whitespace-only note edits as no change', () => {
    const padded = [
      toLineDraft(line({ specificationNotes: '  ' })),
      original[1],
    ];
    expect(lineSignature(padded)).toBe(lineSignature(original));
  });
});

describe('toDateTimeInput', () => {
  it('renders the local wall clock in the format datetime-local expects', () => {
    const iso = new Date(2026, 8, 30, 17, 5).toISOString();
    expect(toDateTimeInput(iso)).toBe('2026-09-30T17:05');
  });
});
