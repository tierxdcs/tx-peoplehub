import { ForbiddenException } from '@nestjs/common';
import { KanbanBoard, Role } from '@prisma/client';
import { KanbanAccessService } from './kanban-access.service';

describe('KanbanAccessService card ownership', () => {
  const owner = {
    id: 'owner-1',
    email: 'punith@example.com',
    role: Role.EMPLOYEE,
    verticalId: null,
  };

  it('keeps structural edit access with the creator after reassignment', async () => {
    const service = new KanbanAccessService({} as never);
    jest
      .spyOn(service, 'assertCanViewCard')
      .mockResolvedValue({ hasBoardAccess: true });
    const manage = jest.spyOn(service, 'assertCanManageBoard');

    await expect(
      service.assertCanEditCard(
        owner,
        'board-1',
        'assignee-1',
        owner.id,
      ),
    ).resolves.toEqual({ canManageBoard: false });
    expect(manage).not.toHaveBeenCalled();
  });

  it('does not give structural edit access to the assignee', async () => {
    const service = new KanbanAccessService({} as never);
    jest
      .spyOn(service, 'assertCanManageBoard')
      .mockRejectedValue(new ForbiddenException('Manager access required'));

    await expect(
      service.assertCanEditCard(
        { ...owner, id: 'assignee-1' },
        'board-1',
        'assignee-1',
        owner.id,
      ),
    ).rejects.toThrow(ForbiddenException);
  });
});

describe('KanbanAccessService board deletion', () => {
  const creator = {
    id: 'creator-1',
    email: 'creator@example.com',
    role: Role.EMPLOYEE,
    verticalId: null,
  };
  const board = { id: 'board-1', createdById: creator.id } as KanbanBoard;

  it('lets the board creator delete their own board', async () => {
    const service = new KanbanAccessService({} as never);
    jest.spyOn(service, 'assertCanViewBoard').mockResolvedValue(board);

    await expect(
      service.assertCanDeleteBoard(creator, board.id),
    ).resolves.toBe(board);
  });

  it('lets a SUPER_ADMIN delete any board', async () => {
    const service = new KanbanAccessService({} as never);
    jest.spyOn(service, 'assertCanViewBoard').mockResolvedValue(board);

    await expect(
      service.assertCanDeleteBoard(
        { ...creator, id: 'super-1', role: Role.SUPER_ADMIN },
        board.id,
      ),
    ).resolves.toBe(board);
  });

  it('forbids a non-creator member (even a Scrum Master) from deleting', async () => {
    const service = new KanbanAccessService({} as never);
    jest.spyOn(service, 'assertCanViewBoard').mockResolvedValue(board);
    // A Scrum Master manages the board but is NOT its creator — must not delete.
    const isScrumMaster = jest
      .spyOn(service, 'isScrumMaster')
      .mockResolvedValue(true);

    await expect(
      service.assertCanDeleteBoard(
        { ...creator, id: 'other-member' },
        board.id,
      ),
    ).rejects.toThrow(ForbiddenException);
    // Deletion is owner-only — Scrum-Master status is irrelevant to this gate.
    expect(isScrumMaster).not.toHaveBeenCalled();
  });
});
