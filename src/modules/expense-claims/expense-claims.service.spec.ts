import { BadRequestException, ForbiddenException } from '@nestjs/common';
import {
  ExpenseClaimStatus,
  ExpenseReceiptStatus,
  Prisma,
  Role,
} from '@prisma/client';
import { ExpenseClaimsService } from './expense-claims.service';

/**
 * Covers the §6 verification checklist for the Employee Expense Claims module:
 *  - receipts are mandatory per line (server-side, not just UI)
 *  - approval authority is limited to the Accounts Head / SUPER_ADMIN
 *  - a SUPER_ADMIN may approve their own claim; the Accounts Head may not
 *  - rejection requires a comment
 *  - the approval journal groups debits by mapped ledger and credits 2500 once
 *  - marking Paid debits 2500 and credits Cash and Bank (1000)
 */
describe('ExpenseClaimsService', () => {
  const prisma: any = {
    expenseClaim: {
      create: jest.fn(),
      findUnique: jest.fn(),
      findMany: jest.fn(),
      update: jest.fn(),
    },
    expenseClaimLine: {
      create: jest.fn(),
      findMany: jest.fn(),
      findUnique: jest.fn(),
      delete: jest.fn(),
      aggregate: jest.fn(),
    },
    expenseCategory: { findUnique: jest.fn() },
    expenseClaimReceipt: {
      create: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    ledgerAccount: { findUnique: jest.fn() },
    $transaction: jest.fn(),
  };
  const numbering: any = { nextNumber: jest.fn() };
  const finance: any = { postJournalTx: jest.fn() };
  const financeAccess: any = {
    accessFor: jest.fn(),
    assertAccountsHead: jest.fn(),
  };
  const storage: any = {
    createUploadUrl: jest.fn(),
    headObject: jest.fn(),
    createDownloadUrl: jest.fn(),
  };
  const service = new ExpenseClaimsService(
    prisma,
    numbering,
    finance,
    financeAccess,
    storage,
    // Best-effort and fire-and-forget; the approval gate is what these tests pin.
    { approvalRequired: jest.fn() } as never,
  );

  const employee: any = { id: 'emp', role: Role.EMPLOYEE, verticalId: 'eng' };
  const head: any = { id: 'head', role: Role.EMPLOYEE, verticalId: 'accounts' };
  const superAdmin: any = {
    id: 'sa',
    role: Role.SUPER_ADMIN,
    verticalId: null,
  };

  const line = (id: string, amount: number, ledgerId: string) => ({
    id,
    expenseDate: new Date('2026-08-01'),
    categoryId: `cat-${id}`,
    description: `line ${id}`,
    amount: new Prisma.Decimal(amount),
    receiptId: `rcpt-${id}`,
    category: { name: 'Travel', defaultExpenseLedgerId: ledgerId },
    receipt: { filename: `${id}.pdf` },
  });

  const claim = (overrides: any = {}) => ({
    id: 'claim-1',
    claimNumber: 'EXP-2026-0001',
    employeeId: 'emp',
    employee: { firstName: 'Ada', lastName: 'Lovelace' },
    title: 'August travel',
    status: ExpenseClaimStatus.SUBMITTED,
    totalAmount: new Prisma.Decimal(180),
    submittedAt: new Date('2026-08-05'),
    approvedById: null,
    approvedBy: null,
    approvedAt: null,
    rejectedById: null,
    rejectedBy: null,
    rejectedAt: null,
    rejectionComment: null,
    paidById: null,
    paidBy: null,
    paidAt: null,
    approvalJournalId: null,
    paymentJournalId: null,
    lines: [
      line('a', 100, '6100'),
      line('b', 50, '6100'),
      line('c', 30, '6000'),
    ],
    createdAt: new Date('2026-08-01'),
    ...overrides,
  });

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.$transaction.mockImplementation((cb: any) => cb(prisma));
    financeAccess.accessFor.mockResolvedValue({
      isFinanceUser: true,
      isAccountsHead: true,
      isFinanceAuditor: false,
    });
    financeAccess.assertAccountsHead.mockResolvedValue(undefined);
    finance.postJournalTx.mockResolvedValue({ id: 'journal-1' });
    prisma.ledgerAccount.findUnique.mockImplementation(
      ({ where: { code } }: any) =>
        Promise.resolve({
          id: code === '2500' ? 'pay-id' : 'cash-id',
          isActive: true,
        }),
    );
    prisma.expenseClaim.update.mockResolvedValue({});
  });

  // ── Receipts are mandatory per line (server-side) ──────────────────────────

  it('rejects a line whose receipt is not yet ACTIVE', async () => {
    prisma.expenseClaim.findUnique.mockResolvedValue({
      id: 'claim-1',
      employeeId: 'emp',
      status: ExpenseClaimStatus.DRAFT,
    });
    prisma.expenseCategory.findUnique.mockResolvedValue({
      id: 'cat-a',
      isActive: true,
    });
    prisma.expenseClaimReceipt.findUnique.mockResolvedValue({
      id: 'rcpt-a',
      uploadedById: 'emp',
      status: ExpenseReceiptStatus.PENDING,
      line: null,
    });
    await expect(
      service.addLine(
        'claim-1',
        {
          expenseDate: '2026-08-01',
          categoryId: 'cat-a',
          description: 'Taxi',
          amount: 100,
          receiptId: 'rcpt-a',
        } as any,
        employee,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.expenseClaimLine.create).not.toHaveBeenCalled();
  });

  it('rejects a line whose receipt is already attached to another line', async () => {
    prisma.expenseClaim.findUnique.mockResolvedValue({
      id: 'claim-1',
      employeeId: 'emp',
      status: ExpenseClaimStatus.DRAFT,
    });
    prisma.expenseCategory.findUnique.mockResolvedValue({
      id: 'cat-a',
      isActive: true,
    });
    prisma.expenseClaimReceipt.findUnique.mockResolvedValue({
      id: 'rcpt-a',
      uploadedById: 'emp',
      status: ExpenseReceiptStatus.ACTIVE,
      line: { id: 'other-line' },
    });
    await expect(
      service.addLine(
        'claim-1',
        {
          expenseDate: '2026-08-01',
          categoryId: 'cat-a',
          description: 'Taxi',
          amount: 100,
          receiptId: 'rcpt-a',
        } as any,
        employee,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.expenseClaimLine.create).not.toHaveBeenCalled();
  });

  it('refuses to submit a claim with no lines', async () => {
    prisma.expenseClaim.findUnique.mockResolvedValue({
      id: 'claim-1',
      employeeId: 'emp',
      status: ExpenseClaimStatus.DRAFT,
    });
    prisma.expenseClaimLine.findMany.mockResolvedValue([]);
    await expect(service.submit('claim-1', employee)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(prisma.expenseClaim.update).not.toHaveBeenCalled();
  });

  // ── Approval authority ─────────────────────────────────────────────────────

  it('blocks a non-approver from approving a claim', async () => {
    prisma.expenseClaim.findUnique.mockResolvedValue(claim());
    financeAccess.assertAccountsHead.mockRejectedValue(
      new ForbiddenException(),
    );
    await expect(service.approve('claim-1', employee)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(finance.postJournalTx).not.toHaveBeenCalled();
  });

  it('lets a SUPER_ADMIN approve their own claim', async () => {
    prisma.expenseClaim.findUnique.mockResolvedValue(
      claim({ employeeId: 'sa' }),
    );
    await service.approve('claim-1', superAdmin);
    expect(finance.postJournalTx).toHaveBeenCalledTimes(1);
    expect(prisma.expenseClaim.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: ExpenseClaimStatus.APPROVED,
          approvedById: 'sa',
        }),
      }),
    );
  });

  it('forbids the Accounts Head from approving their own claim', async () => {
    prisma.expenseClaim.findUnique.mockResolvedValue(
      claim({ employeeId: 'head' }),
    );
    await expect(service.approve('claim-1', head)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(finance.postJournalTx).not.toHaveBeenCalled();
  });

  // ── Rejection requires a comment ───────────────────────────────────────────

  it('requires a comment to reject a claim', async () => {
    prisma.expenseClaim.findUnique.mockResolvedValue(claim());
    await expect(
      service.reject('claim-1', { comment: '   ' } as any, superAdmin),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.expenseClaim.update).not.toHaveBeenCalled();
  });

  // ── Approval journal: grouped debits + single credit to 2500 ───────────────

  it('posts a balanced approval journal with debits grouped by ledger and one credit to 2500', async () => {
    prisma.expenseClaim.findUnique.mockResolvedValue(claim());
    await service.approve('claim-1', superAdmin);

    expect(finance.postJournalTx).toHaveBeenCalledTimes(1);
    const [, params] = finance.postJournalTx.mock.calls[0];
    const legs = params.lines.map((l: any) => ({
      accountId: l.accountId,
      debit: Number(l.debit),
      credit: Number(l.credit),
    }));
    // Two debit lines share ledger 6100 → collapse to a single 150 debit leg.
    expect(legs).toEqual(
      expect.arrayContaining([
        { accountId: '6100', debit: 150, credit: 0 },
        { accountId: '6000', debit: 30, credit: 0 },
        { accountId: 'pay-id', debit: 0, credit: 180 },
      ]),
    );
    expect(legs).toHaveLength(3);
    const debits = legs.reduce((s: number, l: any) => s + l.debit, 0);
    const credits = legs.reduce((s: number, l: any) => s + l.credit, 0);
    expect(debits).toBe(180);
    expect(credits).toBe(180);
  });

  it('only approves SUBMITTED claims', async () => {
    prisma.expenseClaim.findUnique.mockResolvedValue(
      claim({ status: ExpenseClaimStatus.APPROVED }),
    );
    await expect(service.approve('claim-1', superAdmin)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(finance.postJournalTx).not.toHaveBeenCalled();
  });

  // ── Payment journal: debit 2500, credit Cash and Bank (1000) ───────────────

  it('posts the payout journal debiting 2500 and crediting Cash and Bank on Paid', async () => {
    prisma.expenseClaim.findUnique.mockResolvedValue(
      claim({
        status: ExpenseClaimStatus.APPROVED,
        totalAmount: new Prisma.Decimal(180),
      }),
    );
    await service.markPaid('claim-1', superAdmin);

    expect(finance.postJournalTx).toHaveBeenCalledTimes(1);
    const [, params] = finance.postJournalTx.mock.calls[0];
    const legs = params.lines.map((l: any) => ({
      accountId: l.accountId,
      debit: Number(l.debit),
      credit: Number(l.credit),
    }));
    expect(legs).toEqual([
      { accountId: 'pay-id', debit: 180, credit: 0 },
      { accountId: 'cash-id', debit: 0, credit: 180 },
    ]);
    expect(prisma.expenseClaim.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: ExpenseClaimStatus.PAID,
          paidById: 'sa',
        }),
      }),
    );
  });

  it('only pays APPROVED claims', async () => {
    prisma.expenseClaim.findUnique.mockResolvedValue(
      claim({ status: ExpenseClaimStatus.SUBMITTED }),
    );
    await expect(
      service.markPaid('claim-1', superAdmin),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(finance.postJournalTx).not.toHaveBeenCalled();
  });
});
