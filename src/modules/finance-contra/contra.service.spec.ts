import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ContraVoucherStatus, Role } from '@prisma/client';
import { ContraService } from './contra.service';

describe('ContraService', () => {
  const user = { id: 'creator-1', email: 'clerk@example.com', role: Role.EMPLOYEE, verticalId: 'accounts' };
  const headUser = { id: 'head-1', email: 'head@example.com', role: Role.EMPLOYEE, verticalId: 'accounts' };

  const bankGroup = { id: 'grp-bank', code: 'GRP-BANK', name: 'Bank Accounts' };
  const cashGroup = { id: 'grp-cash', code: 'GRP-CASH', name: 'Cash-in-Hand' };
  const expenseGroup = { id: 'grp-exp', code: 'GRP-INDIRECT-EXP', name: 'Indirect Expenses' };

  const bankAccount = { id: 'acc-bank', code: '1000', name: 'Cash and Bank', parentId: 'grp-bank', parent: bankGroup };
  const cashAccount = { id: 'acc-cash', code: '1050', name: 'Petty Cash', parentId: 'grp-cash', parent: cashGroup };
  const expenseAccount = { id: 'acc-exp', code: '6100', name: 'Administrative Expenses', parentId: 'grp-exp', parent: expenseGroup };

  let access: any;
  let finance: any;
  let prisma: any;
  let service: ContraService;

  beforeEach(() => {
    access = {
      assertCanUseFinance: jest.fn().mockResolvedValue(undefined),
      assertAccountsHead: jest.fn().mockResolvedValue(undefined),
    };
    finance = {
      postJournalTx: jest.fn().mockResolvedValue({ id: 'je-1' }),
    };
    prisma = {
      ledgerAccount: { findUnique: jest.fn() },
      contraVoucher: {
        create: jest.fn(),
        findUnique: jest.fn(),
        update: jest.fn(),
        findMany: jest.fn(),
        count: jest.fn(),
      },
      $transaction: jest.fn((cb: any) =>
        typeof cb === 'function'
          ? cb({
              financeSequence: { upsert: jest.fn().mockResolvedValue({ lastValue: 1 }) },
              contraVoucher: prisma.contraVoucher,
            })
          : Promise.all(cb),
      ),
    };
    service = new ContraService(prisma, access, finance);
  });

  describe('create — bank/cash ledger restriction', () => {
    it('rejects when the From ledger is not bank/cash', async () => {
      prisma.ledgerAccount.findUnique.mockResolvedValueOnce(expenseAccount);
      await expect(
        service.create(
          { voucherDate: '2026-07-20', fromLedgerAccountId: 'acc-exp', toLedgerAccountId: 'acc-bank', amount: 1000 },
          user,
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejects when the To ledger is not bank/cash', async () => {
      prisma.ledgerAccount.findUnique
        .mockResolvedValueOnce(bankAccount) // From check passes
        .mockResolvedValueOnce(expenseAccount); // To check fails
      await expect(
        service.create(
          { voucherDate: '2026-07-20', fromLedgerAccountId: 'acc-bank', toLedgerAccountId: 'acc-exp', amount: 1000 },
          user,
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejects identical from/to ledgers before touching the database', async () => {
      await expect(
        service.create(
          { voucherDate: '2026-07-20', fromLedgerAccountId: 'acc-bank', toLedgerAccountId: 'acc-bank', amount: 1000 },
          user,
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.ledgerAccount.findUnique).not.toHaveBeenCalled();
    });

    it('accepts a bank-to-cash transfer (both legs bank/cash-eligible)', async () => {
      prisma.ledgerAccount.findUnique
        .mockResolvedValueOnce(bankAccount)
        .mockResolvedValueOnce(cashAccount);
      prisma.contraVoucher.create.mockResolvedValue({
        id: 'cv-1', voucherNumber: 'CV-2026-00001', status: ContraVoucherStatus.DRAFT,
      });
      const result = await service.create(
        { voucherDate: '2026-07-20', fromLedgerAccountId: 'acc-bank', toLedgerAccountId: 'acc-cash', amount: 5000 },
        user,
      );
      expect(result.voucherNumber).toBe('CV-2026-00001');
    });

    it('throws NotFoundException when the ledger does not exist', async () => {
      prisma.ledgerAccount.findUnique.mockResolvedValueOnce(null);
      await expect(
        service.create(
          { voucherDate: '2026-07-20', fromLedgerAccountId: 'missing', toLedgerAccountId: 'acc-bank', amount: 1000 },
          user,
        ),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('maker-checker', () => {
    it('forbids the creator from approving their own contra voucher', async () => {
      prisma.contraVoucher.findUnique.mockResolvedValue({
        id: 'cv-1', status: ContraVoucherStatus.PENDING_APPROVAL, createdById: 'creator-1',
      });
      await expect(service.approve('cv-1', user)).rejects.toBeInstanceOf(BadRequestException);
      expect(finance.postJournalTx).not.toHaveBeenCalled();
    });

    it('allows a different approver to approve and post', async () => {
      prisma.contraVoucher.findUnique.mockResolvedValue({
        id: 'cv-1',
        status: ContraVoucherStatus.PENDING_APPROVAL,
        createdById: 'creator-1',
        voucherNumber: 'CV-2026-00001',
        voucherDate: new Date('2026-07-20'),
        fromLedgerAccountId: 'acc-bank',
        toLedgerAccountId: 'acc-cash',
        amount: 5000,
        submittedById: 'creator-1',
        submittedAt: new Date('2026-07-20'),
      });
      prisma.contraVoucher.update.mockResolvedValue({
        id: 'cv-1', status: ContraVoucherStatus.POSTED, journalEntryId: 'je-1',
      });

      const result = await service.approve('cv-1', headUser);

      expect(finance.postJournalTx).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          lines: [
            { accountId: 'acc-cash', debit: 5000, credit: 0 },
            { accountId: 'acc-bank', debit: 0, credit: 5000 },
          ],
        }),
      );
      expect(result.status).toBe(ContraVoucherStatus.POSTED);
    });

    it('rejects approving a voucher that is not PENDING_APPROVAL', async () => {
      prisma.contraVoucher.findUnique.mockResolvedValue({
        id: 'cv-1', status: ContraVoucherStatus.DRAFT, createdById: 'someone-else',
      });
      await expect(service.approve('cv-1', headUser)).rejects.toBeInstanceOf(BadRequestException);
    });
  });
});
