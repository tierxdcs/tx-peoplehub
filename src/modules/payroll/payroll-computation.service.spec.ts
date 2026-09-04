import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
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
import {
  COMPANY_PT_STATE,
  StatutoryConfigService,
} from './statutory-config.service';

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
  let statutoryConfig: {
    findEffective: jest.Mock;
    findProfessionalTax: jest.Mock;
  };

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
    accessDeniedAt: null,
    accessDeniedById: null,
    accessDenialReason: null,
    tokenVersion: 0,
    mustChangePassword: false,
    isSalesHead: false,
    isScrumMaster: false,
    isProjectManager: false,
    isInternalAuditor: false,
    isQcInspector: false,
    isQmsHead: false,
    isDesignHead: false,
    isProductionHead: false,
    isRdHead: false,
    isAccountsHead: false,
    isScmHead: false,
    hasExecutiveDashboardAccess: false,
    logisticsAccessLevel: null,
    logisticsAccessStartsAt: null,
    logisticsAccessExpiresAt: null,
    logisticsAccessGrantedAt: null,
    logisticsAccessGrantedById: null,
    logisticsAccessRevokedAt: null,
    logisticsAccessRevokedById: null,
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
    territory: null,
    officialEmail: null,
    emergencyContactName: null,
    emergencyContactRelation: null,
    emergencyContactPhone: null,
    photoStorageKey: null,
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

  const fakeCompanyPtConfig = {
    id: 'pt-company',
    configType: StatutoryConfigType.PROFESSIONAL_TAX,
    state: COMPANY_PT_STATE,
    effectiveFrom: new Date('2026-01-01'),
    effectiveTo: null,
    configData: {
      slabs: [
        { slabFrom: 0, slabTo: 24999, amount: 0 },
        { slabFrom: 25000, slabTo: null, amount: 200 },
      ],
    },
    sourceNote: 'fake',
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const fakeConfigs = {
    pf: fakePfConfig,
    esi: fakeEsiConfig,
    tdsSlab: fakeTdsSlabConfig,
    standardDeduction: fakeStandardDeductionConfig,
    professionalTaxByLocation: new Map(),
    professionalTaxDefault: null,
  } as any;

  beforeEach(async () => {
    prisma = {
      leaveRequest: { findMany: jest.fn().mockResolvedValue([]) },
      employee: { findUnique: jest.fn().mockResolvedValue(employee) },
    };
    salaryStructures = { getCurrentOrThrow: jest.fn() };
    statutoryConfig = {
      findEffective: jest.fn(),
      // The real findProfessionalTax tries the work location as a state key
      // then falls back to the company state (proved in
      // statutory-config.service.spec). Mirrored here so each test can keep
      // driving PT resolution purely through its findEffective stub.
      findProfessionalTax: jest.fn(
        async (workLocation: string | null, asOf: Date) =>
          (workLocation
            ? await statutoryConfig.findEffective(
                StatutoryConfigType.PROFESSIONAL_TAX,
                asOf,
                workLocation,
              )
            : null) ??
          (await statutoryConfig.findEffective(
            StatutoryConfigType.PROFESSIONAL_TAX,
            asOf,
            COMPANY_PT_STATE,
          )),
      ),
    };

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
          if (type === StatutoryConfigType.PROFESSIONAL_TAX)
            return Promise.resolve(fakeCompanyPtConfig);
          return Promise.resolve(null);
        },
      );

      const configs = await service.loadRequiredConfigs(
        new Date('2026-08-31'),
        [employee],
      );

      expect(configs.pf).toEqual(fakePfConfig);
      // employee.workLocation is null — PT still resolves, via the company state.
      expect(configs.professionalTaxDefault).toEqual(fakeCompanyPtConfig);
    });

    it('requires the company-state PT row for employees with no work location — a silent zero-PT payslip is worse than a blocked run', async () => {
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

      await expect(
        service.loadRequiredConfigs(new Date('2026-08-31'), [employee]),
      ).rejects.toThrow(/PROFESSIONAL_TAX config for the company state/);
    });

    it('falls back to the company state when workLocation is not itself a configured PT state', async () => {
      // The real-world case: workLocation is "Hybrid", never a state name.
      const hybridEmployee = { ...employee, workLocation: 'Hybrid' };
      statutoryConfig.findEffective.mockImplementation(
        (type: StatutoryConfigType, _asOf: Date, state?: string | null) => {
          if (type === StatutoryConfigType.PF)
            return Promise.resolve(fakePfConfig);
          if (type === StatutoryConfigType.ESI)
            return Promise.resolve(fakeEsiConfig);
          if (type === StatutoryConfigType.TDS_SLAB)
            return Promise.resolve(fakeTdsSlabConfig);
          if (type === StatutoryConfigType.STANDARD_DEDUCTION) {
            return Promise.resolve(fakeStandardDeductionConfig);
          }
          if (
            type === StatutoryConfigType.PROFESSIONAL_TAX &&
            state === COMPANY_PT_STATE
          ) {
            return Promise.resolve(fakeCompanyPtConfig);
          }
          return Promise.resolve(null);
        },
      );

      const configs = await service.loadRequiredConfigs(
        new Date('2026-08-31'),
        [hybridEmployee],
      );

      expect(configs.professionalTaxByLocation.get('Hybrid')).toEqual(
        fakeCompanyPtConfig,
      );
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
        variablePay: null,
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
        variablePay: null,
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

  describe('computeCtcBreakdown', () => {
    // Karnataka PT slab: 0 below 25k, ₹200 at/above. Keyed by workLocation
    // string, matching the workLocation-as-state-key convention.
    const fakePtConfig = {
      id: 'pt-1',
      configType: StatutoryConfigType.PROFESSIONAL_TAX,
      state: 'Bangalore HQ',
      effectiveFrom: new Date('2026-01-01'),
      effectiveTo: null,
      configData: {
        slabs: [
          { slabFrom: 0, slabTo: 24999, amount: 0 },
          { slabFrom: 25000, slabTo: null, amount: 200 },
        ],
      },
      sourceNote: 'fake',
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const employeeAtHq = { ...employee, workLocation: 'Bangalore HQ' };

    const structure = {
      id: 'ss-ctc',
      employeeId: employee.id,
      effectiveFrom: new Date('2026-01-01'),
      basic: new Prisma.Decimal(56000),
      hra: new Prisma.Decimal(22400),
      specialAllowance: new Prisma.Decimal(36467),
      otherAllowances: null,
      variablePay: new Prisma.Decimal(60000),
      ctcAnnual: new Prisma.Decimal(1460004),
      createdById: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    function findRow(rows: { label: string }[], label: string) {
      const row = rows.find((r) => r.label === label);
      if (!row) throw new Error(`row not found: ${label}`);
      return row as any;
    }

    beforeEach(() => {
      prisma.employee.findUnique.mockResolvedValue(employeeAtHq);
      salaryStructures.getCurrentOrThrow.mockResolvedValue(structure);
    });

    it('throws NotFoundException when the employee does not exist', async () => {
      prisma.employee.findUnique.mockResolvedValue(null);

      await expect(service.computeCtcBreakdown('nope')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('reuses payroll rate logic for the derived rows and no warnings when configured', async () => {
      statutoryConfig.findEffective.mockImplementation(
        (type: StatutoryConfigType) => {
          if (type === StatutoryConfigType.PF)
            return Promise.resolve(fakePfConfig);
          if (type === StatutoryConfigType.ESI)
            return Promise.resolve(fakeEsiConfig);
          if (type === StatutoryConfigType.PROFESSIONAL_TAX)
            return Promise.resolve(fakePtConfig);
          return Promise.resolve(null);
        },
      );

      const result = await service.computeCtcBreakdown('emp-1');

      expect(result.warnings).toEqual([]);
      // gross = 56000 + 22400 + 36467 = 114867
      expect(
        findRow(result.directComponents, 'Sub Total – Gross Salary').perMonth,
      ).toBe('114867');
      // PF capped at ceiling 15000 → 1800; gross > ESI threshold 21000 → "—".
      expect(findRow(result.employeeDeductions, 'Employee PF').perMonth).toBe(
        '1800',
      );
      expect(
        findRow(result.employeeDeductions, 'Employee ESI').perMonth,
      ).toBeNull();
      expect(
        findRow(result.employeeDeductions, 'Professional Tax (PT)').perMonth,
      ).toBe('200');
      // Salary Before Taxes = 114867 − 1800 − 200 = 112867.
      expect(
        findRow(result.employeeDeductions, 'Salary Before Taxes').perMonth,
      ).toBe('112867');
      // Employer PF mirrors employee PF; ESI "—".
      expect(
        findRow(result.indirectBenefits, 'Employer Contribution to PF')
          .perMonth,
      ).toBe('1800');
      // Variable pay stored annual (60000) → monthly 5000.
      expect(findRow(result.indirectBenefits, 'Variable Pay').perMonth).toBe(
        '5000',
      );
      // CTC/mo = gross 114867 + employer PF 1800 = 116667.
      expect(result.grandTotal.perMonth).toBe('116667');
      // CTC/yr = 116667*12 + 60000 variable = 1460004.
      expect(result.grandTotal.perAnnum).toBe('1460004');
    });

    it('does not compute TDS — surfaces it as a note, Net Take Home before TDS', async () => {
      statutoryConfig.findEffective.mockImplementation(
        (type: StatutoryConfigType) => {
          if (type === StatutoryConfigType.PF)
            return Promise.resolve(fakePfConfig);
          if (type === StatutoryConfigType.ESI)
            return Promise.resolve(fakeEsiConfig);
          if (type === StatutoryConfigType.PROFESSIONAL_TAX)
            return Promise.resolve(fakePtConfig);
          return Promise.resolve(null);
        },
      );

      const result = await service.computeCtcBreakdown('emp-1');

      const tds = findRow(result.employeeDeductions, 'TDS (As Applicable)');
      expect(tds.perMonth).toBeNull();
      expect(tds.note).toBeTruthy();
      // Net Take Home equals Salary Before Taxes (no TDS subtracted).
      expect(
        findRow(result.employeeDeductions, 'Net Take Home Salary').perMonth,
      ).toBe(
        findRow(result.employeeDeductions, 'Salary Before Taxes').perMonth,
      );
    });

    it('warns and shows "—" for statutory rows when no config is present', async () => {
      statutoryConfig.findEffective.mockResolvedValue(null);

      const result = await service.computeCtcBreakdown('emp-1');

      expect(result.warnings).toEqual(
        expect.arrayContaining([
          'PF',
          'ESI',
          'Professional Tax (Bangalore HQ)',
        ]),
      );
      expect(
        findRow(result.employeeDeductions, 'Employee PF').perMonth,
      ).toBeNull();
      expect(
        findRow(result.employeeDeductions, 'Professional Tax (PT)').perMonth,
      ).toBeNull();
      // With no employer contributions, CTC/mo == gross, CTC/yr adds variable.
      expect(result.grandTotal.perMonth).toBe('114867');
      expect(result.grandTotal.perAnnum).toBe('1438404'); // 114867*12 + 60000
    });

    it('names the company state in the warning when there is no work location and no PT row anywhere', async () => {
      prisma.employee.findUnique.mockResolvedValue({
        ...employeeAtHq,
        workLocation: null,
      });
      statutoryConfig.findEffective.mockImplementation(
        (type: StatutoryConfigType) => {
          if (type === StatutoryConfigType.PF)
            return Promise.resolve(fakePfConfig);
          if (type === StatutoryConfigType.ESI)
            return Promise.resolve(fakeEsiConfig);
          return Promise.resolve(null);
        },
      );

      const result = await service.computeCtcBreakdown('emp-1');

      expect(result.warnings).toContain(
        `Professional Tax (${COMPANY_PT_STATE})`,
      );
      expect(
        findRow(result.employeeDeductions, 'Professional Tax (PT)').perMonth,
      ).toBeNull();
    });

    it('deducts PT via the company-state fallback when workLocation is not a configured PT state', async () => {
      // Regression: workLocation "Hybrid" used to find no PT row, so the offer
      // letter and CTC breakdown printed Professional Tax as "—".
      prisma.employee.findUnique.mockResolvedValue({
        ...employeeAtHq,
        workLocation: 'Hybrid',
      });
      statutoryConfig.findEffective.mockImplementation(
        (type: StatutoryConfigType, _asOf: Date, state?: string | null) => {
          if (type === StatutoryConfigType.PF)
            return Promise.resolve(fakePfConfig);
          if (type === StatutoryConfigType.ESI)
            return Promise.resolve(fakeEsiConfig);
          if (
            type === StatutoryConfigType.PROFESSIONAL_TAX &&
            state === COMPANY_PT_STATE
          ) {
            return Promise.resolve(fakeCompanyPtConfig);
          }
          return Promise.resolve(null);
        },
      );

      const result = await service.computeCtcBreakdown('emp-1');

      expect(result.warnings).toEqual([]);
      expect(
        findRow(result.employeeDeductions, 'Professional Tax (PT)').perMonth,
      ).toBe('200');
      // Salary Before Taxes = gross 114867 − PF 1800 − PT 200.
      expect(
        findRow(result.employeeDeductions, 'Salary Before Taxes').perMonth,
      ).toBe('112867');
    });
  });
});
