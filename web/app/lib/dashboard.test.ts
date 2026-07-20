import { describe, expect, it } from 'vitest';
import { taskStats, type MyCard } from './dashboard';

function card(id: string, isDone: boolean, isOverdue = false): MyCard {
  return {
    id,
    title: id,
    boardId: 'board-1',
    boardName: 'Board',
    dueDate: isOverdue ? '2026-01-01T00:00:00.000Z' : null,
    isDone,
    isOverdue,
  };
}

describe('dashboard task totals', () => {
  it('changes two assigned cards to one assigned and one completed after a done-list move', () => {
    const before = [card('one', false), card('two', false)];
    expect(taskStats(before, new Date('2026-07-19T12:00:00Z'))).toMatchObject({
      assigned: 2,
      completed: 0,
    });

    const after = [card('one', true), card('two', false)];
    expect(taskStats(after, new Date('2026-07-19T12:00:00Z'))).toMatchObject({
      assigned: 1,
      completed: 1,
    });
  });

  it('does not count a completed card as overdue', () => {
    expect(taskStats([card('done', true, false)], new Date())).toMatchObject({
      completed: 1,
      overdue: 0,
    });
  });
});
