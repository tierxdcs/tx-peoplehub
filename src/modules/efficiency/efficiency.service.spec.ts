import { EfficiencyService } from './efficiency.service';

describe('EfficiencyService', () => {
  it('uses a rolling window and asks only for decided task outcomes', async () => {
    const prisma = {
      pingRecipient: { findMany: jest.fn().mockResolvedValue([]) },
      kanbanCard: { findMany: jest.fn().mockResolvedValue([]) },
    };
    const service = new EfficiencyService(prisma as never);
    const now = new Date('2026-08-22T12:00:00Z');

    const result = await service.mine('employee-1', now);

    const taskWhere = prisma.kanbanCard.findMany.mock.calls[0][0].where;
    expect(taskWhere.assigneeId).toBe('employee-1');
    expect(taskWhere.dueDate).toEqual({ not: null });
    expect(taskWhere.OR).toEqual([
      {
        completedAt: {
          gte: new Date('2026-07-23T12:00:00Z'),
          lte: now,
        },
      },
      {
        completedAt: null,
        dueDate: {
          gte: new Date('2026-07-23T12:00:00Z'),
          lt: now,
        },
      },
    ]);
    expect(result).toMatchObject({ score: null, windowDays: 30 });
  });
});
