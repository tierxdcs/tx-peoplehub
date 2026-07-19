import { BadRequestException } from '@nestjs/common';
import { BankStatementStatus } from '@prisma/client';
import { OperationsService } from './operations.service';

describe('OperationsService bank controls', () => {
  const access = {
    assertCanUseFinance: jest.fn(),
    assertAccountsHead: jest.fn(),
  };
  const prisma = {
    bankStatement: { findUnique: jest.fn(), update: jest.fn() },
    bankTransactionMatch: { deleteMany: jest.fn() },
    bankStatementLine: { findUnique: jest.fn(), update: jest.fn() },
    $transaction: jest.fn(),
  };
  const service = new OperationsService(prisma as any, access as any, { get: jest.fn() } as any);

  beforeEach(() => jest.clearAllMocks());

  it('parses quoted CSV descriptions and Indian dates', () => {
    const rows = service.parseCsv(
      'date,description,reference,debit,credit,balance\n' +
        '18/07/2026,"Vendor payment, machine parts",UTR123,1250.50,0,8750.00',
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].description).toBe('Vendor payment, machine parts');
    expect(rows[0].transactionDate.toISOString()).toContain('2026-07-18');
    expect(rows[0].debitAmount.toString()).toBe('1250.5');
  });

  it('rejects a CSV row containing both debit and credit', () => {
    expect(() =>
      service.parseCsv(
        'date,description,reference,debit,credit\n2026-07-18,Invalid,X,100,100',
      ),
    ).toThrow(BadRequestException);
  });

  it('rejects an unclosed quoted CSV field', () => {
    expect(() =>
      service.parseCsv(
        'date,description,reference,debit,credit\n2026-07-18,"Invalid,X,100,0',
      ),
    ).toThrow('unclosed quoted field');
  });

  it('prevents a Finance Head from approving their imported statement', async () => {
    prisma.bankStatement.findUnique.mockResolvedValue({
      id: 'statement-1',
      status: BankStatementStatus.PENDING_APPROVAL,
      importedById: 'head-1',
      lines: [],
    });
    await expect(
      service.approveStatement('statement-1', { id: 'head-1' } as any),
    ).rejects.toThrow('Finance Head cannot approve a statement they imported');
  });

  it('requires a documented reason for an unmatched bank line', async () => {
    await expect(
      service.acceptUnmatched('line-1', { reason: '   ' }, {
        id: 'user-1',
      } as any),
    ).rejects.toThrow('An unmatched exception reason is required');
  });
});
