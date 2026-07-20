import { KanbanBoardProvisioningService } from './kanban-board-provisioning.service';

describe('KanbanBoardProvisioningService', () => {
  it('creates the standard workflow with exactly one Completed done list', async () => {
    const create = jest
      .fn()
      .mockResolvedValueOnce({ id: 'todo' })
      .mockResolvedValueOnce({ id: 'progress' })
      .mockResolvedValueOnce({ id: 'completed' });
    const service = new KanbanBoardProvisioningService();

    await expect(
      service.createDefaultLists(
        { kanbanList: { create } } as never,
        'board-1',
        'employee-1',
      ),
    ).resolves.toEqual({ todoListId: 'todo', doneListId: 'completed' });

    expect(create.mock.calls.map(([input]) => input.data)).toEqual([
      expect.objectContaining({ name: 'To Do', isDoneList: false }),
      expect.objectContaining({ name: 'In progress', isDoneList: false }),
      expect.objectContaining({ name: 'Completed', isDoneList: true }),
    ]);
  });
});
