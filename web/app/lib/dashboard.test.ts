import { describe, expect, it } from 'vitest';
import { counterTrend, type MyCard } from './dashboard';

const now = new Date(2026, 7, 22, 15, 0, 0); // 22 Aug 2026, mid-afternoon

function iso(y: number, m: number, d: number): string {
  return new Date(y, m, d, 12, 0, 0).toISOString();
}

function card(over: Partial<MyCard>): MyCard {
  return {
    id: 'c',
    title: 't',
    boardId: 'b',
    boardName: null,
    dueDate: null,
    isDone: false,
    isOverdue: false,
    createdAt: iso(2026, 7, 1),
    completedAt: null,
    ...over,
  };
}

describe('counterTrend — real daily history from card timestamps', () => {
  it('counts a card as assigned only between creation and completion', () => {
    const cards = [
      card({ createdAt: iso(2026, 7, 15), completedAt: iso(2026, 7, 19) }),
    ];
    const { series } = counterTrend(cards, 'assigned', now, 14);
    // Window covers 9–22 Aug: index 0 = 9 Aug … index 13 = 22 Aug (today).
    expect(series[5]).toBe(0); // 14 Aug — not yet created
    expect(series[6]).toBe(1); // 15 Aug — created
    expect(series[9]).toBe(1); // 18 Aug — still open
    expect(series[10]).toBe(0); // 19 Aug — completed that day
    expect(series[13]).toBe(0); // today
  });

  it('accumulates completions and reports the week-over-week delta', () => {
    const cards = [
      card({ id: 'a', isDone: true, completedAt: iso(2026, 7, 10) }),
      card({ id: 'b', isDone: true, completedAt: iso(2026, 7, 20) }),
      card({ id: 'c', isDone: true, completedAt: iso(2026, 7, 21) }),
    ];
    const { series, weekDelta } = counterTrend(cards, 'completed', now, 14);
    expect(series[0]).toBe(0); // 9 Aug
    expect(series[1]).toBe(1); // 10 Aug
    expect(series[13]).toBe(3); // today
    // 7 days ago (15 Aug) the total was 1 → delta +2.
    expect(weekDelta).toBe(2);
  });

  it('marks a card overdue only after its due date while still open', () => {
    const cards = [
      card({ dueDate: iso(2026, 7, 12), createdAt: iso(2026, 7, 5) }),
    ];
    const { series } = counterTrend(cards, 'overdue', now, 14);
    // Same semantics as the live isOverdue flag (dueDate < now): a card due at
    // noon is overdue by that day's end-of-day snapshot.
    expect(series[2]).toBe(0); // 11 Aug — before the due date
    expect(series[3]).toBe(1); // 12 Aug — past due by end of day
    expect(series[13]).toBe(1); // still open today
  });

  it('stops counting an overdue card once it is completed', () => {
    const cards = [
      card({
        dueDate: iso(2026, 7, 12),
        createdAt: iso(2026, 7, 5),
        completedAt: iso(2026, 7, 18),
        isDone: true,
      }),
    ];
    const { series } = counterTrend(cards, 'overdue', now, 14);
    expect(series[4]).toBe(1); // 13 Aug — overdue
    expect(series[9]).toBe(0); // 18 Aug — completed
  });

  it('returns a flat zero series for no cards', () => {
    const { series, weekDelta } = counterTrend([], 'assigned', now, 14);
    expect(series).toHaveLength(14);
    expect(series.every((v) => v === 0)).toBe(true);
    expect(weekDelta).toBe(0);
  });
});
