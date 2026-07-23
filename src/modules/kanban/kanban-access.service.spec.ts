import { ForbiddenException } from '@nestjs/common';
import { Role } from '@prisma/client';
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
