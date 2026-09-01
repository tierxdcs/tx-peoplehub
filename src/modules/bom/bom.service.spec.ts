import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
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

/**
 * Releasing a BOM is the moment the cost of a product is settled — for an
 * RFQ-sourced product it is the first moment anyone knows what it costs. The
 * catalog price is derived from that cost, so it has to be written in the same
 * transaction: a released cost with a stale ₹0.00 price beside it is a product
 * a salesperson can quote wrong.
 */
describe('BomService.approve — catalog pricing', () => {
  const pending = {
    id: 'bom-1',
    itemId: 'fg-1',
    revisionNumber: 2,
    status: 'PENDING_APPROVAL',
    createdById: 'author-1',
    effectiveDate: null,
  };
  const approver: any = { id: 'head-2', role: 'MANAGER' };

  function setup(snapshot: Record<string, unknown>) {
    const prisma: any = {
      bom: {
        findUnique: jest.fn().mockResolvedValue(pending),
        findMany: jest.fn().mockResolvedValue([]),
        updateMany: jest.fn(),
        update: jest.fn(),
      },
      bomEvent: { create: jest.fn() },
      employee: {
        findUnique: jest
          .fn()
          .mockResolvedValue({ signatureText: 'RD Head', signatureFont: null }),
      },
      $transaction: jest.fn((cb: any) => cb(prisma)),
    };
    const access: any = {
      assertCanApproveBoms: jest.fn(),
      assertCanBrowseBoms: jest.fn(),
    };
    const notifications: any = { notifyBomWorkflow: jest.fn() };
    const costSnapshots: any = {
      calculate: jest.fn().mockResolvedValue(snapshot),
    };
    const catalogPrice: any = { syncFromReleasedCost: jest.fn() };
    const service = new BomService(
      prisma,
      access,
      notifications,
      costSnapshots,
      catalogPrice,
      { approvalRequired: jest.fn() } as never,
    );
    jest.spyOn(service, 'get').mockResolvedValue({} as never);
    return { service, prisma, catalogPrice };
  }

  it('hands the released cost to the catalog price inside the release transaction', async () => {
    const snapshot = { amount: new Prisma.Decimal('226989.00'), isComplete: true };
    const { service, prisma, catalogPrice } = setup(snapshot);

    await service.approve('bom-1', approver);

    expect(catalogPrice.syncFromReleasedCost).toHaveBeenCalledWith(
      prisma,
      'fg-1',
      snapshot,
    );
    // The same snapshot that was written onto the BOM — the price and the cost
    // it derives from can never disagree.
    expect(prisma.bom.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          rolledUpCostSnapshot: snapshot.amount,
          isCostComplete: true,
        }),
      }),
    );
  });

  it('does not price when the release is refused', async () => {
    const { service, catalogPrice } = setup({
      amount: new Prisma.Decimal(10),
      isComplete: true,
    });
    // An R&D Head may not approve their own BOM.
    await expect(
      service.approve('bom-1', { id: 'author-1', role: 'MANAGER' } as never),
    ).rejects.toThrow(/cannot approve a BOM they created/);
    expect(catalogPrice.syncFromReleasedCost).not.toHaveBeenCalled();
  });
});
