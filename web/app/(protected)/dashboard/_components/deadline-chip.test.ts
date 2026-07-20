import { describe, expect, it } from 'vitest';
import { deadlineLabel } from './deadline-chip';

const now = new Date(2026, 6, 13, 10, 0, 0); // local noon-ish, 13 Jul 2026

function iso(y: number, m: number, d: number): string {
  return new Date(Date.UTC(y, m, d, 12, 0, 0)).toISOString();
}

describe('deadlineLabel — relative phrasing for urgent cases', () => {
  it('phrases overdue relatively', () => {
    expect(deadlineLabel(iso(2026, 6, 11), now)).toBe('2 days over');
    expect(deadlineLabel(iso(2026, 6, 12), now)).toBe('1 day over');
  });

  it('phrases the near-future relatively', () => {
    expect(deadlineLabel(iso(2026, 6, 13), now)).toBe('Due today');
    expect(deadlineLabel(iso(2026, 6, 14), now)).toBe('Due tomorrow');
    expect(deadlineLabel(iso(2026, 6, 16), now)).toBe('Due in 3 days');
  });

  it('uses a plain absolute date beyond the due-soon window', () => {
    // 4+ days out is "normal" — a plain date, no urgency wording.
    expect(deadlineLabel(iso(2026, 6, 20), now)).toMatch(/Due 20 Jul|Due Jul 20/);
  });
});
