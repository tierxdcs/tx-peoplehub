import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { OrderType, Role } from '@prisma/client';
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
