import { Test, TestingModule } from '@nestjs/testing';
import { EmployeeStatus, LeaveAccrualType, Prisma } from '@prisma/client';
import { PrismaService } from '../../core/database/prisma.service';
import { LeaveAccrualService } from './leave-accrual.service';
import { LeaveBalancesService } from './leave-balances.service';

describe('LeaveAccrualService', () => {
  let service: LeaveAccrualService;
  let prisma: any;
  let leaveBalances: { ensureBalances: jest.Mock };

  const elType = {
    id: 'lt-el',
    accrualType: LeaveAccrualType.MONTHLY_ACCRUAL,
    annualQuota: new Prisma.Decimal(18),
  };

  const asOf = new Date('2026-08-01T00:00:00.000Z');

  beforeEach(async () => {
    prisma = {
      leaveType: { findFirst: jest.fn().mockResolvedValue(elType) },
      employee: { findMany: jest.fn() },
      leaveBalance: { update: jest.fn() },
    };
    leaveBalances = { ensureBalances: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        LeaveAccrualService,
        { provide: PrismaService, useValue: prisma },
        { provide: LeaveBalancesService, useValue: leaveBalances },
      ],
    }).compile();

    service = module.get(LeaveAccrualService);
  });

  it('credits an employee whose dateOfJoining is null (created outside HR onboarding)', async () => {
    prisma.employee.findMany.mockResolvedValue([
      { id: 'emp-1', status: EmployeeStatus.ACTIVE, dateOfJoining: null },
    ]);
    leaveBalances.ensureBalances.mockResolvedValue([
      {
        id: 'lb-1',
        leaveTypeId: elType.id,
        allocated: new Prisma.Decimal(0),
        lastAccrualMonth: null,
      },
    ]);

    const result = await service.run(asOf);

    expect(result).toEqual({ credited: 1, skipped: 0 });
    expect(prisma.leaveBalance.update).toHaveBeenCalledWith({
      where: { id: 'lb-1' },
      data: { allocated: 1.5, lastAccrualMonth: '2026-08' },
    });
  });

  it('is idempotent: a second run in the same month skips already-credited balances', async () => {
    prisma.employee.findMany.mockResolvedValue([
      { id: 'emp-1', status: EmployeeStatus.ACTIVE, dateOfJoining: null },
    ]);
    leaveBalances.ensureBalances.mockResolvedValue([
      {
        id: 'lb-1',
        leaveTypeId: elType.id,
        allocated: new Prisma.Decimal(1.5),
        lastAccrualMonth: '2026-08',
      },
    ]);

    const result = await service.run(asOf);

    expect(result).toEqual({ credited: 0, skipped: 1 });
    expect(prisma.leaveBalance.update).not.toHaveBeenCalled();
  });

  it('clamps allocated at the leave type annualQuota', async () => {
    prisma.employee.findMany.mockResolvedValue([
      { id: 'emp-1', status: EmployeeStatus.ACTIVE, dateOfJoining: null },
    ]);
    leaveBalances.ensureBalances.mockResolvedValue([
      {
        id: 'lb-1',
        leaveTypeId: elType.id,
        allocated: new Prisma.Decimal(17), // +1.5 would exceed the 18 cap
        lastAccrualMonth: '2026-07',
      },
    ]);

    await service.run(asOf);

    expect(prisma.leaveBalance.update).toHaveBeenCalledWith({
      where: { id: 'lb-1' },
      data: { allocated: 18, lastAccrualMonth: '2026-08' },
    });
  });

  it('only queries active employees with dateOfJoining on/before month end (via OR with null)', async () => {
    prisma.employee.findMany.mockResolvedValue([]);

    await service.run(asOf);

    expect(prisma.employee.findMany).toHaveBeenCalledWith({
      where: {
        status: EmployeeStatus.ACTIVE,
        OR: [
          { dateOfJoining: null },
          { dateOfJoining: { lte: expect.any(Date) } },
        ],
      },
    });
  });
});
