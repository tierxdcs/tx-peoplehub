import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { PlmDesignReviewStatus, PlmStage, Role } from '@prisma/client';
import { PlmService } from './plm.service';

describe('PlmService', () => {
  const user = {
    id: 'owner-1',
    email: 'owner@example.com',
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
      currentStage: PlmStage.DESIGN_REVIEW,
      status: 'ACTIVE',
      ownerId: user.id,
      vendorId: null,
      productionBoardId: 'board-1',
      designReviewStatus: PlmDesignReviewStatus.PENDING,
      designSubmittedById: user.id,
      order: { id: 'order-1', orderNumber: 'ORD-2026-0001', ownerId: user.id },
      orderLine: {
        product: { item: { boms: [] } },
        qmsInspections: [],
        deliveryChallanLines: [],
      },
      productionCards: [],
      productionUpdates: [],
      events: [],
      ...overrides,
    };
  }

  function setup(raw = tracker()) {
    const prisma = {
      projectKickoff: { findUnique: jest.fn() },
      vendor: { findFirst: jest.fn() },
      plmTracker: {
        upsert: jest.fn(),
        findUnique: jest.fn().mockResolvedValue(raw),
        findMany: jest.fn().mockResolvedValue([]),
      },
      employee: { findUnique: jest.fn() },
      kanbanBoard: { findUnique: jest.fn() },
      $transaction: jest.fn(),
    };
    const access = {
      assertCanOperate: jest.fn().mockResolvedValue(undefined),
      assertProductionHead: jest.fn().mockResolvedValue(undefined),
      assertCanCompleteDesign: jest.fn().mockResolvedValue(undefined),
    };
    const stockReports = { computeReport: jest.fn() };
    const notifications = { notifyPlm: jest.fn().mockResolvedValue(undefined) };
    const service = new PlmService(
      prisma as never,
      access as never,
      stockReports as never,
      notifications as never,
    );
    return { service, prisma, access, stockReports, notifications };
  }

  it('provisions one tracker per classified line with the correct initial flow stage', async () => {
    const { service, prisma } = setup();
    prisma.projectKickoff.findUnique.mockResolvedValue({
      id: 'kickoff-1',
      orderId: 'order-1',
      kanbanBoardId: 'board-1',
      status: 'COMPLETED',
      order: {
        ownerId: 'order-owner',
        lineItems: [
          {
            id: 'npd',
            deliverySplits: [
              {
                id: 'npd-s1',
                deliveryType: 'NPD',
                vendorId: null,
                vendorName: null,
              },
            ],
          },
          {
            id: 'internal',
            deliverySplits: [
              {
                id: 'internal-s1',
                deliveryType: 'IN_HOUSE',
                vendorId: null,
                vendorName: null,
              },
            ],
          },
          {
            id: 'unclassified',
            deliverySplits: [{ id: 'unclass-s1', deliveryType: null }],
          },
        ],
      },
    });
    prisma.plmTracker.upsert.mockResolvedValue({
      createdAt: new Date('2026-01-01'),
      updatedAt: new Date('2026-01-01'),
    });

    await expect(service.provisionForKickoff('kickoff-1')).resolves.toBe(2);
    expect(prisma.plmTracker.upsert).toHaveBeenCalledTimes(2);
    expect(prisma.plmTracker.upsert).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        // Anchored on the split, with the line id kept denormalized.
        where: { splitId: 'npd-s1' },
        create: expect.objectContaining({
          splitId: 'npd-s1',
          orderLineId: 'npd',
          orderId: 'order-1',
          ownerId: 'order-owner',
          currentStage: PlmStage.DESIGN,
        }),
      }),
    );
    expect(prisma.plmTracker.upsert).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        where: { splitId: 'internal-s1' },
        create: expect.objectContaining({
          currentStage: PlmStage.RELEASE_TO_SCM,
        }),
      }),
    );
  });

  it('provisions one tracker per split when a line is sourced from multiple vendors', async () => {
    const { service, prisma } = setup();
    prisma.projectKickoff.findUnique.mockResolvedValue({
      id: 'kickoff-1',
      orderId: 'order-1',
      kanbanBoardId: 'board-1',
      status: 'COMPLETED',
      order: {
        ownerId: 'order-owner',
        lineItems: [
          {
            id: 'split-line',
            deliverySplits: [
              {
                id: 'split-a',
                deliveryType: 'VENDOR',
                vendorId: 'vendor-a',
                vendorName: null,
              },
              {
                id: 'split-b',
                deliveryType: 'VENDOR',
                vendorId: 'vendor-b',
                vendorName: null,
              },
            ],
          },
        ],
      },
    });
    prisma.plmTracker.upsert.mockResolvedValue({
      createdAt: new Date('2026-01-01'),
      updatedAt: new Date('2026-01-01'),
    });

    await expect(service.provisionForKickoff('kickoff-1')).resolves.toBe(2);
    expect(prisma.plmTracker.upsert).toHaveBeenCalledTimes(2);
    // Both trackers share the line id but anchor on their own split + vendor.
    expect(prisma.plmTracker.upsert).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        where: { splitId: 'split-a' },
        create: expect.objectContaining({
          splitId: 'split-a',
          orderLineId: 'split-line',
          vendorId: 'vendor-a',
        }),
      }),
    );
    expect(prisma.plmTracker.upsert).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        where: { splitId: 'split-b' },
        create: expect.objectContaining({
          splitId: 'split-b',
          orderLineId: 'split-line',
          vendorId: 'vendor-b',
        }),
      }),
    );
  });

  it('backfills the vendor link onto an existing VENDOR tracker when the line resolves to a vendor', async () => {
    const { service, prisma } = setup();
    prisma.projectKickoff.findUnique.mockResolvedValue({
      id: 'kickoff-1',
      orderId: 'order-1',
      kanbanBoardId: 'board-1',
      status: 'COMPLETED',
      order: {
        ownerId: 'order-owner',
        lineItems: [
          {
            id: 'vendor-line',
            deliverySplits: [
              {
                id: 'vendor-split',
                deliveryType: 'VENDOR',
                vendorId: 'vendor-7',
                vendorName: null,
              },
            ],
          },
        ],
      },
    });
    prisma.plmTracker.upsert.mockResolvedValue({
      createdAt: new Date('2026-01-01'),
      updatedAt: new Date('2026-02-01'),
    });

    await service.provisionForKickoff('kickoff-1');

    expect(prisma.plmTracker.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { splitId: 'vendor-split' },
        update: { vendorId: 'vendor-7' },
        create: expect.objectContaining({ vendorId: 'vendor-7' }),
      }),
    );
  });

  it('never overwrites an existing vendor link with null when the line has no vendor', async () => {
    const { service, prisma } = setup();
    prisma.projectKickoff.findUnique.mockResolvedValue({
      id: 'kickoff-1',
      orderId: 'order-1',
      kanbanBoardId: 'board-1',
      status: 'COMPLETED',
      order: {
        ownerId: 'order-owner',
        lineItems: [
          {
            id: 'vendor-line',
            deliverySplits: [
              {
                id: 'vendor-split',
                deliveryType: 'VENDOR',
                vendorId: null,
                vendorName: null,
              },
            ],
          },
        ],
      },
    });
    prisma.plmTracker.upsert.mockResolvedValue({
      createdAt: new Date('2026-01-01'),
      updatedAt: new Date('2026-02-01'),
    });

    await service.provisionForKickoff('kickoff-1');

    expect(prisma.plmTracker.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ update: {} }),
    );
  });

  it('blocks self-approval of Design Review even for a Production Head', async () => {
    const { service } = setup();
    await expect(
      service.approveDesignReview('tracker-1', user),
    ).rejects.toThrow(
      new ForbiddenException('You cannot approve your own Design Review'),
    );
  });

  it('blocks Material Planning while the kickoff stock report has a shortage', async () => {
    const { service, stockReports } = setup(
      tracker({ currentStage: PlmStage.MATERIAL_PLANNING }),
    );
    stockReports.computeReport.mockResolvedValue({
      bomSelections: [{ orderLineItemId: 'line-1' }],
      summary: { shortage: 1, unknown: 0 },
    });

    await expect(service.confirmStage('tracker-1', {}, user)).rejects.toThrow(
      new BadRequestException(
        'Material Planning cannot complete while the Kickoff Stock Availability Report has unresolved shortages or unknown stock',
      ),
    );
  });

  it('skips the stock-report check and advances Material Planning by manual confirmation when supply is out of scope', async () => {
    const { service, prisma, stockReports } = setup(
      tracker({
        currentStage: PlmStage.MATERIAL_PLANNING,
        kickoff: { supplyInScope: false },
      }),
    );
    prisma.$transaction.mockImplementation((fn: (tx: unknown) => unknown) =>
      fn({
        plmTracker: {
          update: jest.fn().mockResolvedValue({ id: 'tracker-1' }),
        },
        plmTrackerEvent: { create: jest.fn().mockResolvedValue(undefined) },
      }),
    );

    await service.confirmStage('tracker-1', {}, user);

    expect(stockReports.computeReport).not.toHaveBeenCalled();
    expect(prisma.$transaction).toHaveBeenCalled();
  });

  it('requires a line-linked passed QC inspection before moving to Dispatch', async () => {
    const { service } = setup(tracker({ currentStage: PlmStage.QC }));

    await expect(service.confirmStage('tracker-1', {}, user)).rejects.toThrow(
      'no passed inspection is linked to this order line',
    );
  });

  it('derives a blocked dashboard health signal when Drawing Release lacks a released BOM', async () => {
    const raw = tracker({
      currentStage: PlmStage.DRAWING_RELEASE,
      updatedAt: new Date(),
      owner: { id: user.id, firstName: 'Order', lastName: 'Owner' },
      order: {
        id: 'order-1',
        orderNumber: 'ORD-2026-0001',
        ownerId: user.id,
      },
      orderLine: {
        product: { name: 'Rack', sku: 'RACK-1', item: { boms: [] } },
        qmsInspections: [],
        deliveryChallanLines: [],
      },
      events: [],
    });
    const { service, prisma } = setup(raw);
    prisma.plmTracker.findMany.mockResolvedValue([raw]);

    const result = await service.dashboardForUser({
      ...user,
      role: Role.SUPER_ADMIN,
    });

    expect(result[0]).toEqual(
      expect.objectContaining({
        health: 'BLOCKED',
        blocker: 'Released BOM required',
      }),
    );
  });
});
