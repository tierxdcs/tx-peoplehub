import { Test, TestingModule } from '@nestjs/testing';
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { EmployeeStatus, PayrollRunStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../../core/database/prisma.service';
import { PayrollRunsService } from './payroll-runs.service';
import { PayrollComputationService } from './payroll-computation.service';
import { FinanceAccessService } from '../finance/finance-access.service';
import { FinanceService } from '../finance/finance.service';

describe('PayrollRunsService', () => {
  let service: PayrollRunsService;
  let prisma: any;
  let computation: {
    loadRequiredConfigs: jest.Mock;
    computeForEmployee: jest.Mock;
  };
  let financeAccess: { assertCanUseFinance: jest.Mock };

  const draftRun = {
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

  beforeEach(async () => {
    prisma = {
      payrollRun: {
        findUnique: jest.fn(),
        findMany: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
      },
      payslip: { findMany: jest.fn() },
      attendance: { count: jest.fn().mockResolvedValue(0) },
      employee: { findMany: jest.fn() },
      $transaction: jest.fn(),
    };
    computation = {
      loadRequiredConfigs: jest.fn(),
      computeForEmployee: jest.fn(),
    };
    financeAccess = { assertCanUseFinance: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PayrollRunsService,
        { provide: PrismaService, useValue: prisma },
        { provide: PayrollComputationService, useValue: computation },
        { provide: FinanceAccessService, useValue: financeAccess },
        { provide: FinanceService, useValue: {} },
      ],
    }).compile();

    service = module.get(PayrollRunsService);
  });

  describe('create', () => {
    it('rejects a duplicate month/year run', async () => {
      prisma.payrollRun.findUnique.mockResolvedValue(draftRun);

      await expect(
        service.create({ month: 8, year: 2026 }, 'admin-1'),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('creates a new DRAFT run', async () => {
      prisma.payrollRun.findUnique.mockResolvedValue(null);
      prisma.payrollRun.create.mockResolvedValue(draftRun);

      const result = await service.create({ month: 8, year: 2026 }, 'admin-1');

      expect(result.status).toBe(PayrollRunStatus.DRAFT);
    });
  });

  describe('processRun', () => {
    it('rejects processing a run that is not DRAFT', async () => {
      prisma.payrollRun.findUnique.mockResolvedValue({
        ...draftRun,
        status: PayrollRunStatus.LOCKED,
      });

      await expect(service.processRun('run-1')).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    it('throws before touching any employee when required config is missing', async () => {
      prisma.payrollRun.findUnique.mockResolvedValue(draftRun);
      prisma.employee.findMany.mockResolvedValue([
        { id: 'emp-1', status: EmployeeStatus.ACTIVE },
      ]);
      computation.loadRequiredConfigs.mockRejectedValue(
        new BadRequestException('missing config'),
      );

      await expect(service.processRun('run-1')).rejects.toBeInstanceOf(
        BadRequestException,
      );

      // Status must never have been flipped to PROCESSING.
      expect(prisma.payrollRun.update).not.toHaveBeenCalled();
      expect(computation.computeForEmployee).not.toHaveBeenCalled();
    });

    it('rolls the run back to DRAFT if computation fails mid-transaction', async () => {
      prisma.payrollRun.findUnique.mockResolvedValue(draftRun);
      prisma.employee.findMany.mockResolvedValue([
        { id: 'emp-1', status: EmployeeStatus.ACTIVE },
      ]);
      computation.loadRequiredConfigs.mockResolvedValue({});
      computation.computeForEmployee.mockRejectedValue(
        new NotFoundException('no salary structure'),
      );
      prisma.$transaction.mockImplementation(async (cb: any) =>
        cb({
          payslip: { create: jest.fn() },
          payrollRun: { update: jest.fn() },
        }),
      );

      await expect(service.processRun('run-1')).rejects.toBeInstanceOf(
        NotFoundException,
      );

      // First call sets PROCESSING, second (in the catch block) rolls back to DRAFT.
      const statusUpdates = prisma.payrollRun.update.mock.calls.map(
        (call: any) => call[0].data.status,
      );
      expect(statusUpdates).toEqual([
        PayrollRunStatus.PROCESSING,
        PayrollRunStatus.DRAFT,
      ]);
    });

    it('writes one payslip per employee and marks the run COMPLETED on success', async () => {
      prisma.payrollRun.findUnique.mockResolvedValue(draftRun);
      prisma.employee.findMany.mockResolvedValue([
        { id: 'emp-1', status: EmployeeStatus.ACTIVE },
        { id: 'emp-2', status: EmployeeStatus.ACTIVE },
      ]);
      computation.loadRequiredConfigs.mockResolvedValue({});
      computation.computeForEmployee.mockImplementation((employee: any) =>
        Promise.resolve({
          employeeId: employee.id,
          grossEarnings: 1,
          basicPaid: 1,
          hraPaid: 1,
          specialAllowancePaid: 1,
          otherAllowancesPaid: 1,
          pfEmployee: 1,
          pfEmployer: 1,
          esiEmployee: null,
          esiEmployer: null,
          professionalTax: null,
          tdsDeducted: 1,
          unpaidLeaveDeduction: 0,
          netPay: 1,
          statutoryConfigSnapshot: {},
        }),
      );

      const payslipCreate = jest.fn().mockResolvedValue({});
      const payrollRunUpdate = jest.fn().mockResolvedValue({
        ...draftRun,
        status: PayrollRunStatus.COMPLETED,
      });
      prisma.$transaction.mockImplementation(async (cb: any) =>
        cb({
          payslip: { create: payslipCreate },
          payrollRun: { update: payrollRunUpdate },
        }),
      );

      const result = await service.processRun('run-1');

      expect(payslipCreate).toHaveBeenCalledTimes(2);
      expect(result.status).toBe(PayrollRunStatus.COMPLETED);
    });
  });

  describe('lock', () => {
    it('rejects locking a run that is not COMPLETED', async () => {
      prisma.payrollRun.findUnique.mockResolvedValue(draftRun);

      await expect(service.lock('run-1')).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    it('routes a COMPLETED run through Accounts instead of direct locking', async () => {
      prisma.payrollRun.findUnique.mockResolvedValue({
        ...draftRun,
        status: PayrollRunStatus.COMPLETED,
      });
      await expect(service.lock('run-1')).rejects.toThrow(
        'Submit the completed run to Accounts',
      );
      expect(prisma.payrollRun.update).not.toHaveBeenCalled();
    });
  });

  describe('findOne', () => {
    it('throws NotFoundException for a missing run', async () => {
      prisma.payrollRun.findUnique.mockResolvedValue(null);

      await expect(service.findOne('nope')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  describe('findAll', () => {
    it('returns every run ordered most-recent-first', async () => {
      prisma.payrollRun.findMany.mockResolvedValue([draftRun]);

      const result = await service.findAll();
      expect(prisma.payrollRun.findMany).toHaveBeenCalledWith({
        orderBy: [{ year: 'desc' }, { month: 'desc' }],
      });
      expect(result).toHaveLength(1);
    });
  });

  describe('findPayslips', () => {
    it('throws NotFoundException for a missing run', async () => {
      prisma.payrollRun.findUnique.mockResolvedValue(null);

      await expect(service.findPayslips('nope')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('returns every payslip generated for the run', async () => {
      prisma.payrollRun.findUnique.mockResolvedValue(draftRun);
      prisma.payslip.findMany.mockResolvedValue([
        {
          id: 'payslip-1',
          payrollRunId: 'run-1',
          employeeId: 'emp-1',
          grossEarnings: 1,
          basicPaid: 1,
          hraPaid: 1,
          specialAllowancePaid: 1,
          otherAllowancesPaid: 1,
          pfEmployee: 1,
          pfEmployer: 1,
          esiEmployee: null,
          esiEmployer: null,
          professionalTax: null,
          tdsDeducted: 1,
          unpaidLeaveDeduction: 0,
          netPay: 1,
          statutoryConfigSnapshot: {},
          status: 'GENERATED',
          createdAt: new Date(),
        },
      ]);

      const result = await service.findPayslips('run-1');
      expect(prisma.payslip.findMany).toHaveBeenCalledWith({
        where: { payrollRunId: 'run-1' },
        orderBy: { createdAt: 'asc' },
      });
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('payslip-1');
    });
  });

  describe('financeReview', () => {
    it('groups payroll cost by employee vertical and returns control totals', async () => {
      const decimal = (value: number) => new Prisma.Decimal(value);
      prisma.payrollRun.findUnique.mockResolvedValue({
        ...draftRun,
        status: PayrollRunStatus.PENDING_APPROVAL,
        submittedAt: new Date(),
        payslips: [
          {
            id: 'payslip-1',
            payrollRunId: 'run-1',
            employeeId: 'emp-1',
            grossEarnings: decimal(100),
            basicPaid: decimal(50),
            hraPaid: decimal(20),
            specialAllowancePaid: decimal(30),
            otherAllowancesPaid: decimal(0),
            pfEmployee: decimal(5),
            pfEmployer: decimal(10),
            esiEmployee: null,
            esiEmployer: decimal(2),
            professionalTax: null,
            tdsDeducted: decimal(8),
            unpaidLeaveDeduction: decimal(4),
            netPay: decimal(83),
            statutoryConfigSnapshot: {},
            status: 'GENERATED',
            createdAt: new Date(),
            employee: {
              employeeId: 'EMP-1',
              firstName: 'Asha',
              lastName: 'Rao',
              designation: 'Accountant',
              vertical: { id: 'v1', name: 'Accounts', code: 'ACCOUNTS' },
            },
          },
        ],
      });

      const result = await service.financeReview('run-1', {
        id: 'finance-1',
        email: 'finance@example.com',
        role: 'EMPLOYEE' as never,
        verticalId: 'v1',
      });

      expect(financeAccess.assertCanUseFinance).toHaveBeenCalled();
      expect(result.totals.totalExpense).toBe('108');
      expect(result.verticals).toEqual([
        expect.objectContaining({
          verticalName: 'Accounts',
          employeeCount: 1,
          totalExpense: '108',
        }),
      ]);
      expect(result.payslips[0].employee.employeeId).toBe('EMP-1');
    });
  });
});
