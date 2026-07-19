import { BadRequestException } from '@nestjs/common';
import { Role } from '@prisma/client';
import { FinanceService } from './finance.service';

describe('FinanceService journal controls', () => {
  const user = { id: 'accounts-user', email: 'accounts@example.com', role: Role.EMPLOYEE, verticalId: 'accounts' };
  const access: any = { assertCanUseFinance: jest.fn().mockResolvedValue(undefined), assertAccountsHead: jest.fn() };
  const prisma: any = {
    accountingPeriod: { findFirst: jest.fn() },
    ledgerAccount: { findMany: jest.fn() },
    $transaction: jest.fn(),
  };
  const service = new FinanceService(prisma, access);

  beforeEach(() => jest.clearAllMocks());

  it('rejects an unbalanced journal before accessing the database', async () => {
    await expect(service.createJournal({ entryDate: '2026-07-18', description: 'Bad journal', lines: [
      { accountId: 'cash', debit: 100, credit: 0 },
      { accountId: 'revenue', debit: 0, credit: 99 },
    ] }, user)).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.accountingPeriod.findFirst).not.toHaveBeenCalled();
  });

  it('rejects a line containing both debit and credit', async () => {
    await expect(service.createJournal({ entryDate: '2026-07-18', description: 'Invalid line', lines: [
      { accountId: 'cash', debit: 100, credit: 1 },
      { accountId: 'revenue', debit: 0, credit: 99 },
    ] }, user)).rejects.toBeInstanceOf(BadRequestException);
  });
});
