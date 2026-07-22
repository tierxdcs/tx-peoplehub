import { BadRequestException } from '@nestjs/common';
import { KanbanListsService } from './kanban-lists.service';

describe('KanbanListsService done-list invariant', () => {
  const user = { id: 'employee-1' } as never;

  function setup(isDoneList: boolean) {
    const updateMany = jest.fn().mockResolvedValue({ count: 1 });
    const update = jest.fn().mockResolvedValue({
      id: 'list-2',
      boardId: 'board-1',
      name: 'Completed',
      position: 2048,
      isDoneList: true,
      createdById: 'employee-1',
      createdAt: new Date(),
      updatedAt: new Date(),
      _count: { cards: 0 },
    });
    const tx = { kanbanList: { updateMany, update } };
    const prisma = {
      kanbanList: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'list-2',
          boardId: 'board-1',
          isDoneList,
        }),
        delete: jest.fn(),
      },
      kanbanCard: { count: jest.fn().mockResolvedValue(0) },
      $transaction: jest.fn(async (callback) => callback(tx)),
    };
    const access = {
      assertCanManageLists: jest.fn().mockResolvedValue(undefined),
    };
    return {
      service: new KanbanListsService(prisma as never, access as never),
      prisma,
      updateMany,
      update,
    };
  }

  it('atomically clears the previous holder when designating a new done list', async () => {
    const { service, prisma, updateMany, update } = setup(false);

    await service.updateList('list-2', { isDoneList: true }, user);

    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(updateMany).toHaveBeenCalledWith({
      where: { boardId: 'board-1', isDoneList: true, id: { not: 'list-2' } },
      data: { isDoneList: false },
    });
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'list-2' },
        data: { isDoneList: true },
      }),
    );
  });

  it('blocks unflagging the only done list', async () => {
    const { service } = setup(true);
    await expect(
      service.updateList('list-2', { isDoneList: false }, user),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('blocks deleting the done list', async () => {
    const { service, prisma } = setup(true);
    await expect(service.deleteList('list-2', user)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(prisma.kanbanList.delete).not.toHaveBeenCalled();
  });
});
