import { Test, TestingModule } from '@nestjs/testing';
import { LeaveAccrualType, Prisma } from '@prisma/client';
import { PrismaService } from '../../core/database/prisma.service';
import { LeaveBalancesService } from './leave-balances.service';

describe('LeaveBalancesService', () => {
  let service: LeaveBalancesService;
  let prisma: any;

  const employee = {
    id: 'emp-1',
    dateOfJoining: null as Date | null,
  };

  const clType = {
    id: 'lt-cl',
    code: 'CL',
    accrualType: LeaveAccrualType.FIXED_ANNUAL,
    annualQuota: new Prisma.Decimal(12),
    carryForwardCap: null,
    isActive: true,
  };

  const elType = {
    id: 'lt-el',
    code: 'EL',
    accrualType: LeaveAccrualType.MONTHLY_ACCRUAL,
    annualQuota: new Prisma.Decimal(18),
    carryForwardCap: new Prisma.Decimal(30),
    isActive: true,
  };

  beforeEach(async () => {
    prisma = {
      employee: { findUnique: jest.fn() },
      leaveType: { findMany: jest.fn() },
      leaveBalance: { findUnique: jest.fn(), create: jest.fn() },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        LeaveBalancesService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = module.get(LeaveBalancesService);
  });

  describe('proRatedAnnualQuota (via ensureBalances, FIXED_ANNUAL)', () => {
    function setup(dateOfJoining: Date | null) {
      prisma.employee.findUnique.mockResolvedValue({
        ...employee,
        dateOfJoining,
      });
      prisma.leaveType.findMany.mockResolvedValue([clType]);
      prisma.leaveBalance.findUnique.mockResolvedValue(null);
      prisma.leaveBalance.create.mockImplementation(({ data }: any) =>
        Promise.resolve({ ...data, id: 'lb-1', leaveType: clType }),
      );
    }

    it('grants the full quota when joined in a prior year', async () => {
      setup(new Date('2024-03-15T00:00:00.000Z'));
      const [balance] = await service.ensureBalances('emp-1', 2026);
      expect(balance.allocated.toString()).toBe('12');
    });

    it('grants 0 when joining is in a future year', async () => {
      setup(new Date('2027-01-10T00:00:00.000Z'));
      const [balance] = await service.ensureBalances('emp-1', 2026);
      expect(balance.allocated.toString()).toBe('0');
    });

    it('grants the full quota when there is no dateOfJoining on file', async () => {
      setup(null);
      const [balance] = await service.ensureBalances('emp-1', 2026);
      expect(balance.allocated.toString()).toBe('12');
    });

    it('pro-rates and rounds up to the nearest 0.5 for a mid-year joiner', async () => {
      // Joining in month 7 of 2026: (13 - 7) / 12 * 12 = 6 exactly.
      setup(new Date('2026-07-05T00:00:00.000Z'));
      const [balance] = await service.ensureBalances('emp-1', 2026);
      expect(balance.allocated.toString()).toBe('6');
    });

    it('rounds a non-exact pro-rated quota up to the nearest 0.5', async () => {
      // Joining in month 10: (13 - 10) / 12 * 12 = 3 exactly for quota=12,
      // use a quota that doesn't divide evenly to exercise real rounding.
      const oddQuotaType = { ...clType, annualQuota: new Prisma.Decimal(11) };
      prisma.employee.findUnique.mockResolvedValue({
        ...employee,
        dateOfJoining: new Date('2026-10-01T00:00:00.000Z'),
      });
      prisma.leaveType.findMany.mockResolvedValue([oddQuotaType]);
      prisma.leaveBalance.findUnique.mockResolvedValue(null);
      prisma.leaveBalance.create.mockImplementation(({ data }: any) =>
        Promise.resolve({ ...data, id: 'lb-1', leaveType: oddQuotaType }),
      );

      // (13 - 10) / 12 * 11 = 2.75 -> rounds up to 3.0
      const [balance] = await service.ensureBalances('emp-1', 2026);
      expect(balance.allocated.toString()).toBe('3');
    });
  });

  describe('carryForwardFromPreviousYear (via ensureBalances, MONTHLY_ACCRUAL)', () => {
    it('carries forward 0 when no prior-year row exists', async () => {
      prisma.employee.findUnique.mockResolvedValue(employee);
      prisma.leaveType.findMany.mockResolvedValue([elType]);
      prisma.leaveBalance.findUnique
        .mockResolvedValueOnce(null) // ensureBalances' own existing-row check
        .mockResolvedValueOnce(null); // previous-year lookup
      prisma.leaveBalance.create.mockImplementation(({ data }: any) =>
        Promise.resolve({ ...data, id: 'lb-1', leaveType: elType }),
      );

      const [balance] = await service.ensureBalances('emp-1', 2026);
      expect(balance.carriedForward.toString()).toBe('0');
    });

    it('caps carry-forward at carryForwardCap even if remaining is higher', async () => {
      prisma.employee.findUnique.mockResolvedValue(employee);
      prisma.leaveType.findMany.mockResolvedValue([elType]);
      prisma.leaveBalance.findUnique
        .mockResolvedValueOnce(null) // no current-year row yet
        .mockResolvedValueOnce({
          allocated: new Prisma.Decimal(18),
          carriedForward: new Prisma.Decimal(20),
          used: new Prisma.Decimal(0),
        }); // previous year: remaining = 38, cap = 30
      prisma.leaveBalance.create.mockImplementation(({ data }: any) =>
        Promise.resolve({ ...data, id: 'lb-1', leaveType: elType }),
      );

      const [balance] = await service.ensureBalances('emp-1', 2026);
      expect(balance.carriedForward.toString()).toBe('30');
    });

    it('carries forward 0 when the previous year balance was fully used', async () => {
      prisma.employee.findUnique.mockResolvedValue(employee);
      prisma.leaveType.findMany.mockResolvedValue([elType]);
      prisma.leaveBalance.findUnique
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({
          allocated: new Prisma.Decimal(18),
          carriedForward: new Prisma.Decimal(0),
          used: new Prisma.Decimal(20),
        }); // remaining = -2
      prisma.leaveBalance.create.mockImplementation(({ data }: any) =>
        Promise.resolve({ ...data, id: 'lb-1', leaveType: elType }),
      );

      const [balance] = await service.ensureBalances('emp-1', 2026);
      expect(balance.carriedForward.toString()).toBe('0');
    });
  });

  describe('ensureBalances', () => {
    it('reuses an existing row instead of creating a duplicate', async () => {
      prisma.employee.findUnique.mockResolvedValue(employee);
      prisma.leaveType.findMany.mockResolvedValue([clType]);
      prisma.leaveBalance.findUnique.mockResolvedValue({
        id: 'existing',
        allocated: new Prisma.Decimal(12),
        used: new Prisma.Decimal(0),
        carriedForward: new Prisma.Decimal(0),
        leaveType: clType,
      });

      const balances = await service.ensureBalances('emp-1', 2026);

      expect(balances[0].id).toBe('existing');
      expect(prisma.leaveBalance.create).not.toHaveBeenCalled();
    });
  });

  describe('getOwnBalances', () => {
    it('computes remaining as allocated + carriedForward - used', async () => {
      prisma.employee.findUnique.mockResolvedValue(employee);
      prisma.leaveType.findMany.mockResolvedValue([clType]);
      prisma.leaveBalance.findUnique.mockResolvedValue({
        id: 'existing',
        allocated: new Prisma.Decimal(12),
        used: new Prisma.Decimal(4),
        carriedForward: new Prisma.Decimal(2),
        leaveType: clType,
      });

      const [entity] = await service.getOwnBalances('emp-1', 2026);

      expect(entity.remaining).toBe('10');
    });
  });
});
