import { ProjectKickoffService } from './project-kickoff.service';

describe('ProjectKickoffService progress visibility', () => {
  it('limits the dashboard projection to the creator or an internal attendee', async () => {
    const findMany = jest.fn().mockResolvedValue([]);
    const prisma = { projectKickoff: { findMany } };
    const access = { isSuperAdmin: jest.fn().mockReturnValue(false) };
    const service = new ProjectKickoffService(
      prisma as never,
      access as never,
      {} as never,
      {} as never,
    );

    await expect(
      service.progressForUser({ id: 'employee-1' } as never),
    ).resolves.toEqual([]);

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          OR: [
            { createdById: 'employee-1' },
            { attendees: { some: { employeeId: 'employee-1' } } },
          ],
        },
      }),
    );
  });
});
