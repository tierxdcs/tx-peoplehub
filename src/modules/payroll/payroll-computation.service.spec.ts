import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import {
  Employee,
  EmployeeStatus,
  LeaveRequestStatus,
  PayrollRun,
  PayrollRunStatus,
  Prisma,
  StatutoryConfigType,
} from '@prisma/client';
import { PrismaService } from '../../core/database/prisma.service';
import { PayrollComputationService } from './payroll-computation.service';
import { SalaryStructuresService } from './salary-structures.service';
import { StatutoryConfigService } from './statutory-config.service';

/**
 * IMPORTANT: this spec proves the computation ENGINE correctly applies
 * whatever StatutoryConfig it's given — arbitrary fake rates are used
 * throughout. It does NOT assert that any number here is the real,
 * currently-correct PF/ESI/TDS figure for India. That verification is
 * explicitly out of scope for this codebase (requires CA sign-off) — see
 * the Payroll module's plan/README.
 */
describe('PayrollComputationService', () => {
  let service: PayrollComputationService;
  let prisma: any;
  let salaryStructures: { getCurrentOrThrow: jest.Mock };
  let statutoryConfig: { findEffective: jest.Mock };

  const employee: Employee = {
    id: 'emp-1',
    employeeId: 'EMP-0001',
    firstName: 'Jane',
    lastName: 'Doe',
    email: 'jane@x.com',
    passwordHash: 'hash',
    verticalId: 'v1',
    role: null,
    reportingManagerId: null,
    status: EmployeeStatus.ACTIVE,
    deactivatedAt: null,
    accessStatus: 'ACTIVE' as any,
    isSalesHead: false,
    signatureText: null,
    signatureFont: null,
    dateOfBirth: null,
    gender: null,
    personalEmail: null,
    mobile: null,
    designation: null,
    employmentType: null,
    dateOfJoining: null,
    workLocation: null,
    officialEmail: null,
    emergencyContactName: null,
    emergencyContactRelation: null,
    emergencyContactPhone: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const run: PayrollRun = {
    id: 'run-1',
    month: 8,
    year: 2026,
    status: PayrollRunStatus.DRAFT,
    initiatedById: 'admin-1',
    processedAt: null,
    lockedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const fakePfConfig = {
    id: 'pf-1',
    configType: StatutoryConfigType.PF,
    state: null,
    effectiveFrom: new Date('2026-01-01'),
    effectiveTo: null,
    configData: {
      employeeRate: 0.12,
      employerRate: 0.12,
      epsRate: 0.0833,
      wageCeiling: 15000,
      adminCharge: 0.005,
    },
    sourceNote: 'fake',
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const fakeEsiConfig = {
    id: 'esi-1',
    configType: StatutoryConfigType.ESI,
    state: null,
    effectiveFrom: new Date('2026-01-01'),
    effectiveTo: null,
    configData: {
      employeeRate: 0.0075,
      employerRate: 0.0325,
      wageThreshold: 21000,
    },
    sourceNote: 'fake',
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const fakeTdsSlabConfig = {
    id: 'tds-1',
    configType: StatutoryConfigType.TDS_SLAB,
    state: null,
    effectiveFrom: new Date('2026-01-01'),
    effectiveTo: null,
    configData: {
      slabs: [
        { slabFrom: 0, slabTo: 300000, rate: 0 },
        { slabFrom: 300000, slabTo: null, rate: 0.1 },
      ],
    },
    sourceNote: 'fake',
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const fakeStandardDeductionConfig = {
    id: 'sd-1',
    configType: StatutoryConfigType.STANDARD_DEDUCTION,
    state: null,
    effectiveFrom: new Date('2026-01-01'),
    effectiveTo: null,
    configData: { amount: 50000 },
    sourceNote: 'fake',
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const fakeConfigs = {
    pf: fakePfConfig,
    esi: fakeEsiConfig,
    tdsSlab: fakeTdsSlabConfig,
    standardDeduction: fakeStandardDeductionConfig,
    professionalTaxByState: new Map(),
  } as any;

  beforeEach(async () => {
    prisma = {
      leaveRequest: { findMany: jest.fn().mockResolvedValue([]) },
    };
    salaryStructures = { getCurrentOrThrow: jest.fn() };
    statutoryConfig = { findEffective: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PayrollComputationService,
        { provide: PrismaService, useValue: prisma },
        { provide: SalaryStructuresService, useValue: salaryStructures },
        { provide: StatutoryConfigService, useValue: statutoryConfig },
      ],
    }).compile();

    service = module.get(PayrollComputationService);
  });

  describe('loadRequiredConfigs', () => {
    it('throws naming every missing config type when nothing is configured — the core safety property', async () => {
      statutoryConfig.findEffective.mockResolvedValue(null);

      await expect(
        service.loadRequiredConfigs(new Date('2026-08-31'), [employee]),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('succeeds once every required config type is present', async () => {
      statutoryConfig.findEffective.mockImplementation(
        (type: StatutoryConfigType) => {
          if (type === StatutoryConfigType.PF)
            return Promise.resolve(fakePfConfig);
          if (type === StatutoryConfigType.ESI)
            return Promise.resolve(fakeEsiConfig);
          if (type === StatutoryConfigType.TDS_SLAB)
            return Promise.resolve(fakeTdsSlabConfig);
          if (type === StatutoryConfigType.STANDARD_DEDUCTION) {
            return Promise.resolve(fakeStandardDeductionConfig);
          }
          return Promise.resolve(null);
        },
      );

      const configs = await service.loadRequiredConfigs(
        new Date('2026-08-31'),
        [employee],
      );

      expect(configs.pf).toEqual(fakePfConfig);
    });

    it('additionally requires PROFESSIONAL_TAX per distinct workLocation present among employees', async () => {
      const employeeWithLocation = { ...employee, workLocation: 'Karnataka' };
      statutoryConfig.findEffective.mockImplementation(
        (type: StatutoryConfigType) => {
          if (type === StatutoryConfigType.PROFESSIONAL_TAX)
            return Promise.resolve(null);
          if (type === StatutoryConfigType.PF)
            return Promise.resolve(fakePfConfig);
          if (type === StatutoryConfigType.ESI)
            return Promise.resolve(fakeEsiConfig);
          if (type === StatutoryConfigType.TDS_SLAB)
            return Promise.resolve(fakeTdsSlabConfig);
          if (type === StatutoryConfigType.STANDARD_DEDUCTION) {
            return Promise.resolve(fakeStandardDeductionConfig);
          }
          return Promise.resolve(null);
        },
      );

      await expect(
        service.loadRequiredConfigs(new Date('2026-08-31'), [
          employeeWithLocation,
        ]),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('computeForEmployee', () => {
    beforeEach(() => {
      salaryStructures.getCurrentOrThrow.mockResolvedValue({
        id: 'ss-1',
        employeeId: employee.id,
        effectiveFrom: new Date('2026-01-01'),
        basic: new Prisma.Decimal(50000),
        hra: new Prisma.Decimal(10000),
        specialAllowance: new Prisma.Decimal(5000),
        otherAllowances: null,
        ctcAnnual: new Prisma.Decimal(780000),
        createdById: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
    });

    it('caps PF employee/employer contribution at the wage ceiling', async () => {
      const result = await service.computeForEmployee(
        employee,
        run,
        fakeConfigs,
      );

      // gross = 65000; PF wage base is basic (50000), capped at ceiling 15000.
      expect(result.pfEmployee.toString()).toBe('1800'); // 15000 * 0.12
      expect(result.pfEmployer.toString()).toBe('1800');
    });

    it('omits ESI when gross exceeds the wage threshold', async () => {
      const result = await service.computeForEmployee(
        employee,
        run,
        fakeConfigs,
      );

      expect(result.esiEmployee).toBeNull();
      expect(result.esiEmployer).toBeNull();
    });

    it('applies ESI when gross is within the wage threshold', async () => {
      salaryStructures.getCurrentOrThrow.mockResolvedValue({
        id: 'ss-2',
        employeeId: employee.id,
        effectiveFrom: new Date('2026-01-01'),
        basic: new Prisma.Decimal(15000),
        hra: new Prisma.Decimal(3000),
        specialAllowance: new Prisma.Decimal(0),
        otherAllowances: null,
        ctcAnnual: new Prisma.Decimal(216000),
        createdById: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const result = await service.computeForEmployee(
        employee,
        run,
        fakeConfigs,
      );

      // gross = 18000, within threshold 21000.
      expect(result.esiEmployee?.toString()).toBe('135'); // 18000 * 0.0075
      expect(result.esiEmployer?.toString()).toBe('585'); // 18000 * 0.0325
    });

    it('applies progressive TDS slabs correctly', async () => {
      const result = await service.computeForEmployee(
        employee,
        run,
        fakeConfigs,
      );

      // annualized = 65000*12 = 780000; taxable after 50000 std deduction
      // = 730000; slab: 300000 @ 0%, remaining 430000 @ 10% = 43000/yr,
      // monthly = 3583.33...
      expect(Number(result.tdsDeducted)).toBeCloseTo(3583.33, 1);
    });

    it('sums approved UL leave and pro-rates the deduction by days in month', async () => {
      prisma.leaveRequest.findMany.mockResolvedValue([
        { numberOfDays: new Prisma.Decimal(2) },
      ]);

      const result = await service.computeForEmployee(
        employee,
        run,
        fakeConfigs,
      );

      // August has 31 days; gross 65000 / 31 * 2 days.
      expect(Number(result.unpaidLeaveDeduction)).toBeCloseTo(
        (65000 / 31) * 2,
        1,
      );
    });

    it('filters unpaid-leave query to APPROVED requests of leaveType code UL only', async () => {
      await service.computeForEmployee(employee, run, fakeConfigs);

      expect(prisma.leaveRequest.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            status: LeaveRequestStatus.APPROVED,
            leaveType: { code: 'UL' },
          }),
        }),
      );
    });

    it('snapshots the exact config rows used, for audit traceability', async () => {
      const result = await service.computeForEmployee(
        employee,
        run,
        fakeConfigs,
      );

      expect(result.statutoryConfigSnapshot.pf).toEqual(fakePfConfig);
      expect(result.statutoryConfigSnapshot.esi).toEqual(fakeEsiConfig);
      expect(result.statutoryConfigSnapshot.tdsSlab).toEqual(fakeTdsSlabConfig);
    });

    it('computes netPay as gross minus every deduction', async () => {
      const result = await service.computeForEmployee(
        employee,
        run,
        fakeConfigs,
      );

      const expectedNet = result.grossEarnings
        .minus(result.pfEmployee)
        .minus(result.esiEmployee ?? 0)
        .minus(result.professionalTax ?? 0)
        .minus(result.tdsDeducted)
        .minus(result.unpaidLeaveDeduction);

      expect(result.netPay.toString()).toBe(expectedNet.toString());
    });
  });
});
