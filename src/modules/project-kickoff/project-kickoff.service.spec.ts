import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { OrderType, Prisma, Role } from '@prisma/client';
import { PrismaService } from '../../core/database/prisma.service';
import { AuthenticatedUser } from '../../common/decorators/current-user.decorator';
import { ConfirmationSheetsService } from '../sales/confirmation-sheets.service';
import { KanbanBoardsService } from '../kanban/kanban-boards.service';
import { PlmService } from '../plm/plm.service';
import { ProjectKickoffAccessService } from './project-kickoff-access.service';
import { ProjectKickoffService } from './project-kickoff.service';
import { CreateKickoffDto } from './dto/project-kickoff.dto';

describe('ProjectKickoffService — internal-order gate', () => {
  let service: ProjectKickoffService;
  let prisma: any;
  let access: any;
  let confirmationSheets: { latestIsExecutedFor: jest.Mock };
  let boards: { provisionProjectBoard: jest.Mock };

  const pm: AuthenticatedUser = {
    id: 'emp-pm',
    email: 'pm@x.com',
    role: Role.EMPLOYEE,
    verticalId: 'v-eng',
  };

  beforeEach(async () => {
    prisma = {
      order: { findUnique: jest.fn(), findMany: jest.fn() },
      projectKickoff: { create: jest.fn() },
    };
    access = {
      assertCanCreate: jest.fn().mockResolvedValue(undefined),
      isSuperAdmin: jest.fn().mockReturnValue(false),
    };
    confirmationSheets = { latestIsExecutedFor: jest.fn() };
    boards = {
      provisionProjectBoard: jest
        .fn()
        .mockResolvedValue({ boardId: 'board-1' }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ProjectKickoffService,
        { provide: PrismaService, useValue: prisma },
        { provide: ProjectKickoffAccessService, useValue: access },
        { provide: ConfirmationSheetsService, useValue: confirmationSheets },
        { provide: KanbanBoardsService, useValue: boards },
        { provide: PlmService, useValue: {} },
      ],
    }).compile();

    service = module.get(ProjectKickoffService);
  });

  const dto = {
    orderId: 'order-1',
    meetingDate: '2026-08-15T00:00:00.000Z',
  } as CreateKickoffDto;

  describe('create', () => {
    it('blocks a CUSTOMER order whose Confirmation Sheet is not executed', async () => {
      prisma.order.findUnique.mockResolvedValue({
        id: 'order-1',
        orderNumber: 'ORD-2026-0001',
        orderType: OrderType.CUSTOMER,
        bid: null,
        customer: { name: 'Acme' },
        lineItems: [],
      });
      confirmationSheets.latestIsExecutedFor.mockResolvedValue(false);

      await expect(service.create(dto, pm)).rejects.toBeInstanceOf(
        BadRequestException,
      );
      // The gate fires before any board/kickoff is provisioned.
      expect(boards.provisionProjectBoard).not.toHaveBeenCalled();
    });

    it('lets an INTERNAL order kick off without consulting the OCS gate', async () => {
      prisma.order.findUnique.mockResolvedValue({
        id: 'order-1',
        orderNumber: 'ORD-2026-0002',
        orderType: OrderType.INTERNAL,
        bid: null,
        customer: null, // internal order with no prospective customer
        lineItems: [],
      });
      prisma.projectKickoff.create.mockResolvedValue({ id: 'ko-1' });
      // Short-circuit the final read; we only care about the gate + provisioning.
      const findOne = jest
        .spyOn(service, 'findOne')
        .mockResolvedValue({ id: 'ko-1' } as any);

      await service.create(dto, pm);

      // Gate is skipped entirely for internal orders.
      expect(confirmationSheets.latestIsExecutedFor).not.toHaveBeenCalled();
      // Board provisions with the "Internal — <order#>" default name.
      expect(boards.provisionProjectBoard).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'Internal — ORD-2026-0002' }),
      );
      expect(prisma.projectKickoff.create).toHaveBeenCalled();
      expect(findOne).toHaveBeenCalledWith('ko-1', pm);
    });
  });

  describe('eligibleOrders', () => {
    it('admits internal orders (gate-exempt) + executed customer orders only', async () => {
      prisma.order.findMany.mockResolvedValue([
        {
          id: 'o-int',
          orderNumber: 'ORD-INT',
          orderType: OrderType.INTERNAL,
          customer: null,
        },
        {
          id: 'o-exec',
          orderNumber: 'ORD-EXEC',
          orderType: OrderType.CUSTOMER,
          customer: { name: 'Acme' },
        },
        {
          id: 'o-pending',
          orderNumber: 'ORD-PEND',
          orderType: OrderType.CUSTOMER,
          customer: { name: 'Beta' },
        },
      ]);
      confirmationSheets.latestIsExecutedFor.mockImplementation(
        (id: string) => Promise.resolve(id === 'o-exec'),
      );

      const result = await service.eligibleOrders(pm);

      expect(result.map((o) => o.id)).toEqual(['o-int', 'o-exec']);
      expect(result.find((o) => o.id === 'o-int')?.customerName).toBeNull();
      // The internal order is never run through the OCS gate.
      expect(confirmationSheets.latestIsExecutedFor).not.toHaveBeenCalledWith(
        'o-int',
      );
    });
  });
});

describe('ProjectKickoffService — delivery splits', () => {
  let service: ProjectKickoffService;
  let prisma: any;
  let access: any;
  let plm: { provisionForKickoff: jest.Mock };
  let tx: any;

  const pm: AuthenticatedUser = {
    id: 'emp-pm',
    email: 'pm@x.com',
    role: Role.EMPLOYEE,
    verticalId: 'v-eng',
  };

  /** A refreshed line for the post-save read; its shape drives toDeliveryItem. */
  function refreshedLine(splits: any[] = []) {
    return {
      id: 'line-1',
      product: { name: 'Platform Emergency Kiosk', sku: 'PEK-1' },
      adHocProductName: null,
      quantity: new Prisma.Decimal(212),
      deliverySplits: splits,
    };
  }

  beforeEach(async () => {
    tx = {
      orderLineDeliverySplit: {
        deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
        update: jest.fn().mockResolvedValue({}),
        create: jest.fn().mockResolvedValue({}),
      },
    };
    prisma = {
      orderLineItem: {
        findFirst: jest.fn(),
        findUniqueOrThrow: jest.fn().mockResolvedValue(refreshedLine()),
      },
      vendor: { findUnique: jest.fn() },
      $transaction: jest.fn().mockImplementation((cb: any) => cb(tx)),
    };
    access = {
      assertCanManage: jest
        .fn()
        .mockResolvedValue({ id: 'ko-1', orderId: 'order-1' }),
    };
    plm = { provisionForKickoff: jest.fn().mockResolvedValue(1) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ProjectKickoffService,
        { provide: PrismaService, useValue: prisma },
        { provide: ProjectKickoffAccessService, useValue: access },
        { provide: ConfirmationSheetsService, useValue: {} },
        { provide: KanbanBoardsService, useValue: {} },
        { provide: PlmService, useValue: plm },
      ],
    }).compile();

    service = module.get(ProjectKickoffService);
  });

  it('rejects a split set that does not fully allocate the line quantity', async () => {
    prisma.orderLineItem.findFirst.mockResolvedValue({
      id: 'line-1',
      quantity: new Prisma.Decimal(212),
      deliverySplits: [{ id: 's1', deliveryType: null, plmTracker: null }],
    });

    await expect(
      service.updateDeliveryItem(
        'ko-1',
        'line-1',
        { splits: [{ id: 's1', quantity: 100 }, { quantity: 50 }] } as any,
        pm,
      ),
    ).rejects.toThrow(/add up to exactly the line quantity \(212\)/);
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(plm.provisionForKickoff).not.toHaveBeenCalled();
  });

  it('reconciles splits: updates a kept split, creates a new one, deletes the missing one', async () => {
    prisma.orderLineItem.findFirst.mockResolvedValue({
      id: 'line-1',
      quantity: new Prisma.Decimal(212),
      deliverySplits: [
        { id: 's1', deliveryType: 'VENDOR', plmTracker: null },
        { id: 's2', deliveryType: 'VENDOR', plmTracker: null },
      ],
    });

    await service.updateDeliveryItem(
      'ko-1',
      'line-1',
      {
        splits: [
          {
            id: 's1',
            quantity: 100,
            deliveryType: 'VENDOR',
            vendorName: 'Vendor A',
          },
          { quantity: 112, deliveryType: 'VENDOR', vendorName: 'Vendor B' },
        ],
      } as any,
      pm,
    );

    // s2 dropped from the payload → deleted; s1 updated; one new split created.
    expect(tx.orderLineDeliverySplit.deleteMany).toHaveBeenCalledWith({
      where: { id: { in: ['s2'] } },
    });
    expect(tx.orderLineDeliverySplit.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 's1' } }),
    );
    expect(tx.orderLineDeliverySplit.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ orderLineId: 'line-1' }),
      }),
    );
    // Provisioning fires so any newly-typed split gets its own tracker.
    expect(plm.provisionForKickoff).toHaveBeenCalledWith('ko-1');
  });

  it('refuses to remove a split that already has a PLM tracker', async () => {
    prisma.orderLineItem.findFirst.mockResolvedValue({
      id: 'line-1',
      quantity: new Prisma.Decimal(100),
      deliverySplits: [
        { id: 's1', deliveryType: 'VENDOR', plmTracker: { id: 'plm-1' } },
      ],
    });

    await expect(
      service.updateDeliveryItem(
        'ko-1',
        'line-1',
        // No id on the sole split → it would remove the tracked s1.
        { splits: [{ quantity: 100, deliveryType: 'VENDOR' }] } as any,
        pm,
      ),
    ).rejects.toThrow(/cannot be removed/);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('refuses to change the delivery type of a tracked split', async () => {
    prisma.orderLineItem.findFirst.mockResolvedValue({
      id: 'line-1',
      quantity: new Prisma.Decimal(100),
      deliverySplits: [
        { id: 's1', deliveryType: 'VENDOR', plmTracker: { id: 'plm-1' } },
      ],
    });

    await expect(
      service.updateDeliveryItem(
        'ko-1',
        'line-1',
        {
          splits: [{ id: 's1', quantity: 100, deliveryType: 'IN_HOUSE' }],
        } as any,
        pm,
      ),
    ).rejects.toThrow(/Delivery type cannot change/);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('auto-fills the fixed manufacturing partner when a split is set to IN_HOUSE', async () => {
    prisma.orderLineItem.findFirst.mockResolvedValue({
      id: 'line-1',
      quantity: new Prisma.Decimal(100),
      deliverySplits: [{ id: 's1', deliveryType: null, plmTracker: null }],
    });

    await service.updateDeliveryItem(
      'ko-1',
      'line-1',
      { splits: [{ id: 's1', quantity: 100, deliveryType: 'IN_HOUSE' }] } as any,
      pm,
    );

    expect(tx.orderLineDeliverySplit.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 's1' },
        data: expect.objectContaining({
          deliveryType: 'IN_HOUSE',
          vendorName: 'Balaji MetalTech, Bengaluru',
          vendorId: null,
        }),
      }),
    );
  });

  it('rejects a split pointed at a non-approved Vendor Master record', async () => {
    prisma.orderLineItem.findFirst.mockResolvedValue({
      id: 'line-1',
      quantity: new Prisma.Decimal(100),
      deliverySplits: [{ id: 's1', deliveryType: 'VENDOR', plmTracker: null }],
    });
    prisma.vendor.findUnique.mockResolvedValue({
      id: 'vendor-7',
      companyName: 'Vendor Seven',
      status: 'PENDING',
    });

    await expect(
      service.updateDeliveryItem(
        'ko-1',
        'line-1',
        {
          splits: [
            {
              id: 's1',
              quantity: 100,
              deliveryType: 'VENDOR',
              vendorId: 'vendor-7',
            },
          ],
        } as any,
        pm,
      ),
    ).rejects.toThrow(/approved Vendor Master/);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('defaults vendorName from an approved Vendor Master when only vendorId is given', async () => {
    prisma.orderLineItem.findFirst.mockResolvedValue({
      id: 'line-1',
      quantity: new Prisma.Decimal(100),
      deliverySplits: [{ id: 's1', deliveryType: 'VENDOR', plmTracker: null }],
    });
    prisma.vendor.findUnique.mockResolvedValue({
      id: 'vendor-7',
      companyName: 'Vendor Seven',
      status: 'APPROVED_PREFERRED',
    });

    await service.updateDeliveryItem(
      'ko-1',
      'line-1',
      {
        splits: [
          {
            id: 's1',
            quantity: 100,
            deliveryType: 'VENDOR',
            vendorId: 'vendor-7',
          },
        ],
      } as any,
      pm,
    );

    expect(tx.orderLineDeliverySplit.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          vendorId: 'vendor-7',
          vendorName: 'Vendor Seven',
        }),
      }),
    );
  });
});
