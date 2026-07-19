import { BadRequestException } from '@nestjs/common';
import {
  AccountType,
  AccountingPeriodStatus,
  FinanceBudgetStatus,
  FinanceScheduleStatus,
  Prisma,
} from '@prisma/client';
import { ManagementService } from './management.service';

describe('ManagementService accounting controls', () => {
  const access = {
    assertCanUseFinance: jest.fn(),
    assertAccountsHead: jest.fn(),
  };
  const prisma = {
    financeBudget: { findUnique: jest.fn(), update: jest.fn() },
    financeSchedule: { findMany: jest.fn(), update: jest.fn() },
    accountingPeriod: { findFirst: jest.fn() },
    $transaction: jest.fn(),
  };
  const service = new ManagementService(prisma as any, access as any);

  beforeEach(() => jest.clearAllMocks());

  it('uses credit-minus-debit for revenue actuals', () => {
    const value = (service as any).actualValue(
      AccountType.REVENUE,
      new Prisma.Decimal(100),
      new Prisma.Decimal(1000),
    );
    expect(value.toString()).toBe('900');
  });

  it('caps generated schedule dates at remaining runs', () => {
    const dates = (service as any).dueDates(
      {
        nextRunDate: new Date('2026-04-01T00:00:00Z'),
        endDate: null,
        remainingRuns: 2,
      },
      new Date('2026-12-31T00:00:00Z'),
    );
    expect(dates.map((d: Date) => d.toISOString().slice(0, 10))).toEqual([
      '2026-04-01',
      '2026-05-01',
    ]);
  });

  it('prevents a Finance Head from approving their own budget', async () => {
    prisma.financeBudget.findUnique.mockResolvedValue({
      id: 'budget-1',
      status: FinanceBudgetStatus.PENDING_APPROVAL,
      createdById: 'head-1',
      lines: [],
      fiscalYear: { periods: [] },
    });
    await expect(
      service.approveBudget('budget-1', { id: 'head-1' } as any),
    ).rejects.toThrow('Finance Head cannot approve a budget they created');
  });

  it('rejects an asset whose residual value reaches original cost', async () => {
    await expect(
      service.createAsset(
        {
          name: 'Machine',
          purchaseDate: '2026-04-01',
          capitalizationDate: '2026-04-01',
          originalCost: 100000,
          residualValue: 100000,
          usefulLifeMonths: 60,
          assetAccountId: 'a',
          accumulatedDepreciationAccountId: 'b',
          depreciationExpenseAccountId: 'c',
          acquisitionCreditAccountId: 'd',
        },
        { id: 'user-1' } as any,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('preflights closed periods before posting scheduled journals', async () => {
    prisma.financeSchedule.findMany.mockResolvedValue([
      {
        id: 'schedule-1',
        scheduleNumber: 'SCH-1',
        status: FinanceScheduleStatus.ACTIVE,
        nextRunDate: new Date('2026-04-01T00:00:00Z'),
        endDate: null,
        remainingRuns: 1,
      },
    ]);
    prisma.accountingPeriod.findFirst.mockResolvedValue({
      status: AccountingPeriodStatus.CLOSED,
    });
    await expect(
      service.runSchedules('2026-04-30', { id: 'head-1' } as any),
    ).rejects.toThrow('requires an open period');
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});
