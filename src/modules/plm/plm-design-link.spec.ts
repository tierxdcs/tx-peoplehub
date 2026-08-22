import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { PlmDesignReviewStatus, PlmStage, Role } from '@prisma/client';
import { PlmService } from './plm.service';

describe('PlmService linked design-project gate', () => {
  const user = {
    id: 'head-1',
    email: 'head@example.com',
    role: Role.MANAGER,
    verticalId: null,
  };

  function tracker(overrides: Record<string, unknown> = {}) {
    return {
      id: 'tracker-1',
      orderLineId: 'line-1',
      orderId: 'order-1',
      kickoffId: 'kickoff-1',
      kickoff: { supplyInScope: true, vendorUpdateCadenceDays: 1 },
      flowType: 'NPD',
      currentStage: PlmStage.DESIGN,
      status: 'ACTIVE',
      ownerId: 'owner-1',
      designReviewStatus: PlmDesignReviewStatus.NOT_SUBMITTED,
      designSubmittedById: null,
      order: {
        id: 'order-1',
        orderNumber: 'ORD-2026-0001',
        ownerId: 'owner-1',
      },
      orderLine: {
        productId: 'product-1',
        product: { name: 'Rack', sku: 'RACK-1', item: { boms: [] } },
        qmsInspections: [],
        deliveryChallanLines: [],
      },
      productionCards: [],
      productionUpdates: [],
      events: [],
      ...overrides,
    };
  }

  const project = (status: string) => ({
    id: 'dp-1',
    projectNumber: 'DP-2026-00001',
    name: 'Kiosk',
    status,
  });

  function setup(raw = tracker()) {
    const prisma = {
      designProject: { findFirst: jest.fn().mockResolvedValue(null) },
      plmTracker: { findUnique: jest.fn().mockResolvedValue(raw) },
      employee: { findMany: jest.fn().mockResolvedValue([]) },
      $transaction: jest.fn().mockImplementation((fn: (tx: unknown) => unknown) =>
        fn({
          plmTracker: {
            update: jest.fn().mockResolvedValue({ id: 'tracker-1' }),
          },
          plmTrackerEvent: { create: jest.fn().mockResolvedValue(undefined) },
        }),
      ),
    };
    const access = {
      assertCanCompleteDesign: jest.fn().mockResolvedValue(undefined),
      assertProductionHead: jest.fn().mockResolvedValue(undefined),
    };
    const notifications = { notifyPlm: jest.fn().mockResolvedValue(undefined) };
    const service = new PlmService(
      prisma as never,
      access as never,
      { computeReport: jest.fn() } as never,
      notifications as never,
    );
    return { service, prisma, access };
  }

  describe('submitDesignReview (past DESIGN)', () => {
    it('blocks submission when the linked design project has not reached Detailed Design', async () => {
      const { service, prisma } = setup();
      prisma.designProject.findFirst.mockResolvedValue(project('CONCEPT'));

      await expect(
        service.submitDesignReview('tracker-1', user),
      ).rejects.toThrow(
        new BadRequestException(
          'Design project DP-2026-00001 is at CONCEPT; it must reach at least DETAILED DESIGN before Design can be submitted for review',
        ),
      );
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('matches the design project on the tracker order + product pair', async () => {
      const { service, prisma } = setup();
      prisma.designProject.findFirst.mockResolvedValue(
        project('DETAILED_DESIGN'),
      );

      await service.submitDesignReview('tracker-1', user);

      expect(prisma.designProject.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { orderId: 'order-1', productId: 'product-1' },
        }),
      );
      expect(prisma.$transaction).toHaveBeenCalled();
    });

    it('allows submission at or beyond the Detailed Design threshold', async () => {
      const { service, prisma } = setup();
      prisma.designProject.findFirst.mockResolvedValue(
        project('CUSTOMER_APPROVAL'),
      );
      await service.submitDesignReview('tracker-1', user);
      expect(prisma.$transaction).toHaveBeenCalled();
    });

    it('does not block on an off-ladder (ON_HOLD) design project', async () => {
      const { service, prisma } = setup();
      prisma.designProject.findFirst.mockResolvedValue(project('ON_HOLD'));
      await service.submitDesignReview('tracker-1', user);
      expect(prisma.$transaction).toHaveBeenCalled();
    });

    it('does not block when no design project is linked', async () => {
      const { service, prisma } = setup();
      await service.submitDesignReview('tracker-1', user);
      expect(prisma.$transaction).toHaveBeenCalled();
    });

    it('skips the lookup entirely when the order line has no catalog product', async () => {
      const raw = tracker();
      (raw.orderLine as { productId: string | null }).productId = null;
      const { service, prisma } = setup(raw);
      await service.submitDesignReview('tracker-1', user);
      expect(prisma.designProject.findFirst).not.toHaveBeenCalled();
      expect(prisma.$transaction).toHaveBeenCalled();
    });
  });

  describe('approveDesignReview (past DESIGN_REVIEW)', () => {
    const pendingReview = () =>
      tracker({
        currentStage: PlmStage.DESIGN_REVIEW,
        designReviewStatus: PlmDesignReviewStatus.PENDING,
        designSubmittedById: 'someone-else',
      });

    it('blocks approval when the linked design project has not reached Customer Approval', async () => {
      const { service, prisma, access } = setup(pendingReview());
      prisma.designProject.findFirst.mockResolvedValue(
        project('INTERNAL_REVIEW'),
      );

      await expect(
        service.approveDesignReview('tracker-1', user),
      ).rejects.toThrow(
        new BadRequestException(
          'Design project DP-2026-00001 is at INTERNAL REVIEW; it must reach at least CUSTOMER APPROVAL before the Design Review can be approved',
        ),
      );
      // The gate is additive: the Production Head requirement still ran first.
      expect(access.assertProductionHead).toHaveBeenCalled();
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('allows approval at or beyond the Customer Approval threshold', async () => {
      const { service, prisma, access } = setup(pendingReview());
      prisma.designProject.findFirst.mockResolvedValue(
        project('CUSTOMER_APPROVAL'),
      );
      await service.approveDesignReview('tracker-1', user);
      expect(access.assertProductionHead).toHaveBeenCalled();
      expect(prisma.$transaction).toHaveBeenCalled();
    });

    it('still requires Production Head even when the design project passes the gate', async () => {
      const { service, prisma, access } = setup(pendingReview());
      prisma.designProject.findFirst.mockResolvedValue(
        project('RELEASED_FOR_PRODUCTION'),
      );
      access.assertProductionHead.mockRejectedValue(new ForbiddenException());
      await expect(
        service.approveDesignReview('tracker-1', user),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('does not block approval when no design project is linked', async () => {
      const { service, prisma } = setup(pendingReview());
      await service.approveDesignReview('tracker-1', user);
      expect(prisma.$transaction).toHaveBeenCalled();
    });
  });
});
