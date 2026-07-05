import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, ForbiddenException } from '@nestjs/common';
import {
  LeaveAccrualType,
  LeaveRequestStatus,
  Prisma,
  Role,
} from '@prisma/client';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../core/database/prisma.service';
import { AuthenticatedUser } from '../../common/decorators/current-user.decorator';
import { LeaveRequestsService } from './leave-requests.service';
import { LeaveBalancesService } from './leave-balances.service';

describe('LeaveRequestsService', () => {
  let service: LeaveRequestsService;
  let prisma: any;
  let leaveBalances: { ensureBalances: jest.Mock };

  const clType = {
    id: 'lt-cl',
    isActive: true,
    accrualType: LeaveAccrualType.FIXED_ANNUAL,
  };
  const ulType = {
    id: 'lt-ul',
    isActive: true,
    accrualType: LeaveAccrualType.UNTRACKED,
  };

  const manager: AuthenticatedUser = {
    id: 'mgr-1',
    email: 'mgr@x.com',
    role: Role.MANAGER,
    verticalId: 'v1',
  };
  const admin: AuthenticatedUser = {
    id: 'admin-1',
    email: 'admin@x.com',
    role: Role.ADMIN,
    verticalId: null,
  };
  const employeeUser: AuthenticatedUser = {
    id: 'emp-1',
    email: 'emp@x.com',
    role: Role.EMPLOYEE,
    verticalId: 'v1',
  };

  function baseRequest(overrides: any = {}) {
    return {
      id: 'req-1',
      employeeId: 'emp-1',
      leaveTypeId: 'lt-cl',
      startDate: new Date('2026-08-10T00:00:00.000Z'),
      endDate: new Date('2026-08-12T00:00:00.000Z'),
      numberOfDays: new Prisma.Decimal(3),
      reason: 'test',
      status: LeaveRequestStatus.PENDING,
      approverId: null,
      approvedAt: null,
      approverComments: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      ...overrides,
    };
  }

  beforeEach(async () => {
    prisma = {
      employee: { findUnique: jest.fn() },
      leaveType: { findUnique: jest.fn(), findUniqueOrThrow: jest.fn() },
      leaveRequest: {
        create: jest.fn(),
        findFirst: jest.fn(),
        findUnique: jest.fn(),
        findMany: jest.fn(),
        count: jest.fn(),
        update: jest.fn(),
      },
      $transaction: jest.fn(),
    };
    leaveBalances = { ensureBalances: jest.fn().mockResolvedValue([]) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        LeaveRequestsService,
        { provide: PrismaService, useValue: prisma },
        { provide: LeaveBalancesService, useValue: leaveBalances },
        {
          provide: ConfigService,
          useValue: { get: jest.fn().mockReturnValue('Asia/Kolkata') },
        },
      ],
    }).compile();

    service = module.get(LeaveRequestsService);
  });

  describe('create', () => {
    const dto = {
      leaveTypeId: 'lt-cl',
      startDate: '2026-08-10',
      endDate: '2026-08-12',
      numberOfDays: 3,
      reason: 'Family function',
    };

    it('rejects an overlapping request', async () => {
      prisma.employee.findUnique.mockResolvedValue({
        id: 'emp-1',
        role: Role.EMPLOYEE,
      });
      prisma.leaveType.findUnique.mockResolvedValue(clType);
      prisma.leaveRequest.findFirst.mockResolvedValue(baseRequest());

      await expect(service.create(dto, employeeUser)).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    it('rejects numberOfDays that is not a multiple of 0.5', async () => {
      prisma.employee.findUnique.mockResolvedValue({
        id: 'emp-1',
        role: Role.EMPLOYEE,
      });
      prisma.leaveType.findUnique.mockResolvedValue(clType);
      prisma.leaveRequest.findFirst.mockResolvedValue(null);

      await expect(
        service.create({ ...dto, numberOfDays: 1.3 }, employeeUser),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejects numberOfDays exceeding the calendar span', async () => {
      prisma.employee.findUnique.mockResolvedValue({
        id: 'emp-1',
        role: Role.EMPLOYEE,
      });
      prisma.leaveType.findUnique.mockResolvedValue(clType);
      prisma.leaveRequest.findFirst.mockResolvedValue(null);

      // Aug 10-12 spans 3 days; requesting 4 must fail.
      await expect(
        service.create({ ...dto, numberOfDays: 4 }, employeeUser),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('creates a PENDING request for a normal employee, no balance check yet', async () => {
      prisma.employee.findUnique.mockResolvedValue({
        id: 'emp-1',
        role: Role.EMPLOYEE,
      });
      prisma.leaveType.findUnique.mockResolvedValue(clType);
      prisma.leaveRequest.findFirst.mockResolvedValue(null);
      prisma.leaveRequest.create.mockResolvedValue(baseRequest());

      const result = await service.create(dto, employeeUser);

      expect(result.status).toBe(LeaveRequestStatus.PENDING);
      expect(leaveBalances.ensureBalances).not.toHaveBeenCalled();
    });

    it('auto-approves a SUPER_ADMIN request and deducts balance immediately', async () => {
      const superAdminUser: AuthenticatedUser = {
        id: 'sa-1',
        email: 'sa@x.com',
        role: Role.SUPER_ADMIN,
        verticalId: null,
      };
      prisma.employee.findUnique.mockResolvedValue({
        id: 'sa-1',
        role: Role.SUPER_ADMIN,
      });
      prisma.leaveType.findUnique.mockResolvedValue(clType);
      prisma.leaveRequest.findFirst.mockResolvedValue(null);
      leaveBalances.ensureBalances.mockResolvedValue([]);

      const txLeaveBalance = {
        findUnique: jest.fn().mockResolvedValue({
          allocated: new Prisma.Decimal(12),
          carriedForward: new Prisma.Decimal(0),
          used: new Prisma.Decimal(0),
        }),
        update: jest.fn().mockResolvedValue({}),
      };
      prisma.$transaction.mockImplementation(async (cb: any) =>
        cb({
          leaveBalance: txLeaveBalance,
          leaveRequest: {
            create: jest.fn().mockResolvedValue(
              baseRequest({
                employeeId: 'sa-1',
                status: LeaveRequestStatus.APPROVED,
                approverComments:
                  'Auto-approved: no reporting manager (SUPER_ADMIN)',
              }),
            ),
          },
        }),
      );

      const result = await service.create(dto, superAdminUser);

      expect(result.status).toBe(LeaveRequestStatus.APPROVED);
      expect(txLeaveBalance.update).toHaveBeenCalled();
    });

    it('rejects a SUPER_ADMIN request when balance is insufficient', async () => {
      const superAdminUser: AuthenticatedUser = {
        id: 'sa-1',
        email: 'sa@x.com',
        role: Role.SUPER_ADMIN,
        verticalId: null,
      };
      prisma.employee.findUnique.mockResolvedValue({
        id: 'sa-1',
        role: Role.SUPER_ADMIN,
      });
      prisma.leaveType.findUnique.mockResolvedValue(clType);
      prisma.leaveRequest.findFirst.mockResolvedValue(null);
      leaveBalances.ensureBalances.mockResolvedValue([]);

      const txLeaveBalance = {
        findUnique: jest.fn().mockResolvedValue({
          allocated: new Prisma.Decimal(1),
          carriedForward: new Prisma.Decimal(0),
          used: new Prisma.Decimal(0),
        }),
      };
      prisma.$transaction.mockImplementation(async (cb: any) =>
        cb({ leaveBalance: txLeaveBalance, leaveRequest: {} }),
      );

      await expect(service.create(dto, superAdminUser)).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    it('does not balance-check an UNTRACKED (UL) request', async () => {
      prisma.employee.findUnique.mockResolvedValue({
        id: 'emp-1',
        role: Role.EMPLOYEE,
      });
      prisma.leaveType.findUnique.mockResolvedValue(ulType);
      prisma.leaveRequest.findFirst.mockResolvedValue(null);
      prisma.leaveRequest.create.mockResolvedValue(
        baseRequest({ leaveTypeId: 'lt-ul' }),
      );

      await service.create({ ...dto, leaveTypeId: 'lt-ul' }, employeeUser);

      expect(leaveBalances.ensureBalances).not.toHaveBeenCalled();
    });
  });

  describe('approve / reject authorization', () => {
    it('blocks self-approval regardless of role', async () => {
      const request = baseRequest({ employeeId: manager.id });
      prisma.leaveRequest.findUnique.mockResolvedValue(request);

      await expect(
        service.approve('req-1', manager, undefined),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('allows the resolved manager to approve', async () => {
      const request = baseRequest();
      prisma.leaveRequest.findUnique.mockResolvedValue(request);
      prisma.employee.findUnique.mockResolvedValue({
        reportingManagerId: manager.id,
      });
      prisma.leaveType.findUniqueOrThrow.mockResolvedValue(clType);
      leaveBalances.ensureBalances.mockResolvedValue([]);

      const txLeaveBalance = {
        findUnique: jest.fn().mockResolvedValue({
          allocated: new Prisma.Decimal(12),
          carriedForward: new Prisma.Decimal(0),
          used: new Prisma.Decimal(0),
        }),
        update: jest.fn().mockResolvedValue({}),
      };
      prisma.$transaction.mockImplementation(async (cb: any) =>
        cb({
          leaveBalance: txLeaveBalance,
          leaveRequest: {
            update: jest
              .fn()
              .mockResolvedValue(
                baseRequest({ status: LeaveRequestStatus.APPROVED }),
              ),
          },
        }),
      );

      const result = await service.approve('req-1', manager, 'ok');
      expect(result.status).toBe(LeaveRequestStatus.APPROVED);
    });

    it('rejects an unrelated MANAGER who is not the resolved approver', async () => {
      const request = baseRequest();
      prisma.leaveRequest.findUnique.mockResolvedValue(request);
      prisma.employee.findUnique.mockResolvedValue({
        reportingManagerId: 'someone-else',
      });

      await expect(
        service.approve('req-1', manager, undefined),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('allows ADMIN to act on any request regardless of hierarchy', async () => {
      const request = baseRequest();
      prisma.leaveRequest.findUnique.mockResolvedValue(request);
      prisma.leaveType.findUniqueOrThrow.mockResolvedValue(clType);
      leaveBalances.ensureBalances.mockResolvedValue([]);

      const txLeaveBalance = {
        findUnique: jest.fn().mockResolvedValue({
          allocated: new Prisma.Decimal(12),
          carriedForward: new Prisma.Decimal(0),
          used: new Prisma.Decimal(0),
        }),
        update: jest.fn().mockResolvedValue({}),
      };
      prisma.$transaction.mockImplementation(async (cb: any) =>
        cb({
          leaveBalance: txLeaveBalance,
          leaveRequest: {
            update: jest
              .fn()
              .mockResolvedValue(
                baseRequest({ status: LeaveRequestStatus.APPROVED }),
              ),
          },
        }),
      );

      const result = await service.approve('req-1', admin, undefined);
      expect(result.status).toBe(LeaveRequestStatus.APPROVED);
      // Admin's approval never triggers a hierarchy lookup.
      expect(prisma.employee.findUnique).not.toHaveBeenCalled();
    });

    it('rejects approving a non-PENDING request', async () => {
      const request = baseRequest({ status: LeaveRequestStatus.APPROVED });
      prisma.leaveRequest.findUnique.mockResolvedValue(request);

      await expect(
        service.approve('req-1', admin, undefined),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('reject() does not touch the balance', async () => {
      const request = baseRequest();
      prisma.leaveRequest.findUnique.mockResolvedValue(request);
      prisma.leaveRequest.update.mockResolvedValue(
        baseRequest({ status: LeaveRequestStatus.REJECTED }),
      );

      const result = await service.reject('req-1', admin, 'not now');

      expect(result.status).toBe(LeaveRequestStatus.REJECTED);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });
  });

  describe('cancel', () => {
    it('restores balance when cancelling a previously APPROVED request', async () => {
      const request = baseRequest({
        status: LeaveRequestStatus.APPROVED,
        startDate: new Date('2099-01-01T00:00:00.000Z'),
        endDate: new Date('2099-01-03T00:00:00.000Z'),
      });
      prisma.leaveRequest.findUnique.mockResolvedValue(request);
      prisma.leaveType.findUniqueOrThrow.mockResolvedValue(clType);

      const txLeaveBalance = { update: jest.fn().mockResolvedValue({}) };
      prisma.$transaction.mockImplementation(async (cb: any) =>
        cb({
          leaveBalance: txLeaveBalance,
          leaveRequest: {
            update: jest
              .fn()
              .mockResolvedValue(
                baseRequest({ status: LeaveRequestStatus.CANCELLED }),
              ),
          },
        }),
      );

      const result = await service.cancel('req-1', employeeUser);

      expect(result.status).toBe(LeaveRequestStatus.CANCELLED);
      expect(txLeaveBalance.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { used: { increment: -3 } },
        }),
      );
    });

    it('rejects cancelling a request whose startDate has already passed', async () => {
      const request = baseRequest({
        status: LeaveRequestStatus.PENDING,
        startDate: new Date('2020-01-01T00:00:00.000Z'),
      });
      prisma.leaveRequest.findUnique.mockResolvedValue(request);

      await expect(
        service.cancel('req-1', employeeUser),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejects cancellation by someone who is neither requester nor approver', async () => {
      const request = baseRequest({
        status: LeaveRequestStatus.PENDING,
        startDate: new Date('2099-01-01T00:00:00.000Z'),
        approverId: 'mgr-1',
      });
      prisma.leaveRequest.findUnique.mockResolvedValue(request);

      const stranger: AuthenticatedUser = {
        id: 'stranger-1',
        email: 'x@x.com',
        role: Role.EMPLOYEE,
        verticalId: 'v1',
      };

      await expect(service.cancel('req-1', stranger)).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    });
  });

  describe('getPendingApproval', () => {
    it('scopes MANAGER queries to their direct reports only', async () => {
      prisma.$transaction.mockResolvedValue([[], 0]);

      await service.getPendingApproval(manager, {
        page: 1,
        limit: 20,
        skip: 0,
      } as any);

      expect(prisma.leaveRequest.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            status: LeaveRequestStatus.PENDING,
            employee: { reportingManagerId: manager.id },
          },
        }),
      );
    });

    it('scopes ADMIN queries company-wide', async () => {
      prisma.$transaction.mockResolvedValue([[], 0]);

      await service.getPendingApproval(admin, {
        page: 1,
        limit: 20,
        skip: 0,
      } as any);

      expect(prisma.leaveRequest.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { status: LeaveRequestStatus.PENDING },
        }),
      );
    });
  });
});
