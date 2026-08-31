import { BadRequestException, NotFoundException } from '@nestjs/common';
import { BomService } from './bom.service';

/**
 * `submit` and `submitTransition` are deliberately split so two callers with
 * two different authorisation rules can share one transition (R&D authors via
 * `POST /bom/:id/submit`, Sales via `POST /customer-bom-intakes/:id/submit`).
 * These tests pin the half of that split that could silently widen access: the
 * guard must stay on `submit`, and it must fire before anything is written.
 */
describe('BomService submit / submitTransition', () => {
  function setup(bom: Record<string, unknown> | null) {
    const prisma: any = {
      bom: { findUnique: jest.fn().mockResolvedValue(bom), update: jest.fn() },
      bomEvent: { create: jest.fn() },
      employee: { findMany: jest.fn().mockResolvedValue([{ id: 'head-1' }]) },
      item: { findUnique: jest.fn().mockResolvedValue({ name: 'Kiosk' }) },
      $transaction: jest.fn((cb: any) => cb(prisma)),
    };
    const access: any = {
      assertCanAuthorBoms: jest.fn(),
      assertCanBrowseBoms: jest.fn(),
    };
    const notifications: any = { notifyBomWorkflow: jest.fn() };
    const pushEvents: any = { approvalRequired: jest.fn() };
    const service = new BomService(
      prisma,
      access,
      notifications,
      {} as never,
      pushEvents,
    );
    return { service, prisma, access, notifications, pushEvents };
  }
  const draft = {
    id: 'bom-1',
    itemId: 'item-1',
    revisionNumber: 3,
    status: 'DRAFT',
    lines: [{ id: 'line-1' }],
  };
  const user: any = { id: 'author-1', role: 'EMPLOYEE' };

  describe('submitTransition — the shared, deliberately unguarded body', () => {
    it('moves DRAFT to PENDING_APPROVAL stamping the actual submitter, and clears any prior rejection', async () => {
      const { service, prisma } = setup(draft);

      await service.submitTransition('bom-1', user);

      expect(prisma.bom.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'bom-1' },
          data: expect.objectContaining({
            status: 'PENDING_APPROVAL',
            submittedById: 'author-1',
            rejectedById: null,
            rejectionComment: null,
          }),
        }),
      );
      expect(prisma.bomEvent.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            type: 'SUBMITTED',
            actorId: 'author-1',
          }),
        }),
      );
    });

    it('notifies and pushes to the same R&D Head pool, so the two channels cannot disagree', async () => {
      const { service, prisma, notifications, pushEvents } = setup(draft);
      prisma.employee.findMany.mockResolvedValue([
        { id: 'head-1' },
        { id: 'head-2' },
      ]);

      await service.submitTransition('bom-1', user);

      expect(notifications.notifyBomWorkflow).toHaveBeenCalledTimes(2);
      expect(notifications.notifyBomWorkflow).toHaveBeenCalledWith(
        expect.objectContaining({
          recipientId: 'head-2',
          type: 'BOM_SUBMITTED',
        }),
      );
      expect(pushEvents.approvalRequired).toHaveBeenCalledWith(
        expect.objectContaining({
          kind: 'bom-release',
          audience: { employeeIds: ['head-1', 'head-2'] },
        }),
      );
    });

    it('accepts a REJECTED BOM so a rework can be resubmitted', async () => {
      const { service, prisma } = setup({ ...draft, status: 'REJECTED' });
      await service.submitTransition('bom-1', user);
      expect(prisma.bom.update).toHaveBeenCalled();
    });

    it('refuses a BOM that is not DRAFT or REJECTED', async () => {
      const { service, prisma } = setup({ ...draft, status: 'RELEASED' });
      await expect(
        service.submitTransition('bom-1', user),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('refuses an empty BOM, so neither door can submit nothing', async () => {
      const { service, prisma } = setup({ ...draft, lines: [] });
      await expect(
        service.submitTransition('bom-1', user),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('404s on an unknown BOM', async () => {
      const { service } = setup(null);
      await expect(
        service.submitTransition('nope', user),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('submit — the R&D-author door', () => {
    it('keeps the R&D-vertical guard, and refuses before any write', async () => {
      const { service, prisma, access } = setup(draft);
      access.assertCanAuthorBoms.mockRejectedValue(new Error('forbidden'));

      await expect(service.submit('bom-1', user)).rejects.toThrow('forbidden');

      expect(prisma.bom.findUnique).not.toHaveBeenCalled();
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('runs the same shared transition once the author is authorised', async () => {
      const { service, prisma, access } = setup(draft);
      // get() reads the BOM back for the response; not under test here.
      jest.spyOn(service, 'get').mockResolvedValue({ id: 'bom-1' } as never);

      await service.submit('bom-1', user);

      expect(access.assertCanAuthorBoms).toHaveBeenCalledWith(user);
      expect(prisma.bom.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: 'PENDING_APPROVAL' }),
        }),
      );
    });
  });
});
