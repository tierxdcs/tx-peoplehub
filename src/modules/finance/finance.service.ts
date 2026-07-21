import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  AccountType,
  AccountingPeriodStatus,
  JournalStatus,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../../core/database/prisma.service';
import { AuthenticatedUser } from '../../common/decorators/current-user.decorator';
import { PaginationQueryDto } from '../../common/dto/pagination.dto';
import {
  CreateAccountDto,
  CreateCostCenterDto,
  CreateExchangeRateDto,
  CreateFiscalYearDto,
  CreateJournalDto,
  DaybookQueryDto,
  DaybookVoucherType,
  ReportQueryDto,
  UpdateAccountDto,
} from './dto/finance.dto';
import { FinanceAccessService } from './finance-access.service';

const JOURNAL_INCLUDE = {
  period: true,
  createdBy: { select: { id: true, firstName: true, lastName: true } },
  approvedBy: { select: { id: true, firstName: true, lastName: true } },
  lines: { include: { account: true, costCenter: true }, orderBy: { sequence: 'asc' as const } },
};

@Injectable()
export class FinanceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: FinanceAccessService,
  ) {}

  async getAccess(user: AuthenticatedUser) {
    return this.access.accessFor(user);
  }

  async createFiscalYear(dto: CreateFiscalYearDto, user: AuthenticatedUser) {
    await this.access.assertCanUseFinance(user);
    const startsOn = new Date(Date.UTC(dto.startYear, 3, 1));
    const endsOn = new Date(Date.UTC(dto.startYear + 1, 2, 31, 23, 59, 59, 999));
    const overlap = await this.prisma.fiscalYear.findFirst({
      where: { startsOn: { lte: endsOn }, endsOn: { gte: startsOn } },
    });
    if (overlap) throw new ConflictException('A fiscal year already covers this date range');
    return this.prisma.fiscalYear.create({
      data: {
        name: dto.name,
        startsOn,
        endsOn,
        createdById: user.id,
        periods: {
          create: Array.from({ length: 12 }, (_, index) => {
            const starts = new Date(Date.UTC(dto.startYear, 3 + index, 1));
            const ends = new Date(Date.UTC(dto.startYear, 4 + index, 0, 23, 59, 59, 999));
            return {
              periodNumber: index + 1,
              name: starts.toLocaleString('en-IN', { month: 'long', year: 'numeric', timeZone: 'UTC' }),
              startsOn: starts,
              endsOn: ends,
            };
          }),
        },
      },
      include: { periods: { orderBy: { periodNumber: 'asc' } } },
    });
  }

  async fiscalYears(user: AuthenticatedUser) {
    await this.access.assertCanUseFinance(user);
    return this.prisma.fiscalYear.findMany({
      include: { periods: { orderBy: { periodNumber: 'asc' } } },
      orderBy: { startsOn: 'desc' },
    });
  }

  async setPeriodStatus(id: string, status: AccountingPeriodStatus, user: AuthenticatedUser) {
    await this.access.assertAccountsHead(user);
    const period = await this.prisma.accountingPeriod.findUnique({ where: { id } });
    if (!period) throw new NotFoundException('Accounting period not found');
    return this.prisma.accountingPeriod.update({ where: { id }, data: { status } });
  }

  async createAccount(dto: CreateAccountDto, user: AuthenticatedUser) {
    await this.access.assertCanUseFinance(user);
    if (dto.parentId) await this.assertAccount(dto.parentId);
    return this.prisma.ledgerAccount.create({
      data: { ...dto, code: dto.code.toUpperCase(), createdById: user.id },
    });
  }

  async accounts(user: AuthenticatedUser) {
    await this.access.assertCanUseFinance(user);
    return this.prisma.ledgerAccount.findMany({ orderBy: { code: 'asc' } });
  }

  async updateAccount(id: string, dto: UpdateAccountDto, user: AuthenticatedUser) {
    await this.access.assertCanUseFinance(user);
    await this.assertAccount(id);
    if (dto.parentId === id) throw new BadRequestException('An account cannot be its own parent');
    return this.prisma.ledgerAccount.update({ where: { id }, data: dto });
  }

  async createCostCenter(dto: CreateCostCenterDto, user: AuthenticatedUser) {
    await this.access.assertCanUseFinance(user);
    return this.prisma.costCenter.create({
      data: { ...dto, code: dto.code.toUpperCase(), createdById: user.id },
    });
  }

  async costCenters(user: AuthenticatedUser) {
    await this.access.assertCanUseFinance(user);
    return this.prisma.costCenter.findMany({ orderBy: { code: 'asc' } });
  }

  async currencies(user: AuthenticatedUser) {
    await this.access.assertCanUseFinance(user);
    return this.prisma.currency.findMany({ where: { isActive: true }, orderBy: { code: 'asc' } });
  }

  async createExchangeRate(dto: CreateExchangeRateDto, user: AuthenticatedUser) {
    await this.access.assertCanUseFinance(user);
    const code = dto.currencyCode.toUpperCase();
    if (code === 'INR') throw new BadRequestException('INR is the base currency and does not need an exchange rate');
    const currency = await this.prisma.currency.findUnique({ where: { code } });
    if (!currency?.isActive) throw new BadRequestException('Unsupported or inactive currency');
    return this.prisma.exchangeRate.create({
      data: {
        currencyCode: code,
        effectiveOn: this.utcDay(dto.effectiveOn),
        rateToInr: new Prisma.Decimal(dto.rateToInr),
        source: dto.source,
        createdById: user.id,
      },
    });
  }

  async exchangeRates(user: AuthenticatedUser) {
    await this.access.assertCanUseFinance(user);
    return this.prisma.exchangeRate.findMany({ include: { currency: true }, orderBy: { effectiveOn: 'desc' } });
  }

  async createJournal(dto: CreateJournalDto, user: AuthenticatedUser) {
    await this.access.assertCanUseFinance(user);
    this.validateLines(dto.lines);
    const entryDate = this.utcDay(dto.entryDate);
    const period = await this.findOpenPeriod(entryDate);
    const accounts = await this.prisma.ledgerAccount.findMany({
      where: { id: { in: dto.lines.map((line) => line.accountId) }, isActive: true },
    });
    if (accounts.length !== new Set(dto.lines.map((line) => line.accountId)).size) {
      throw new BadRequestException('Every journal line must reference an active ledger account');
    }
    return this.prisma.$transaction(async (tx) => {
      const seq = await tx.financeSequence.upsert({
        where: { entity_year: { entity: 'JOURNAL', year: entryDate.getUTCFullYear() } },
        create: { entity: 'JOURNAL', year: entryDate.getUTCFullYear(), lastValue: 1 },
        update: { lastValue: { increment: 1 } },
      });
      const journalNumber = `JV-${entryDate.getUTCFullYear()}-${String(seq.lastValue).padStart(5, '0')}`;
      return tx.journalEntry.create({
        data: {
          journalNumber,
          entryDate,
          periodId: period.id,
          description: dto.description,
          reference: dto.reference,
          createdById: user.id,
          lines: {
            create: dto.lines.map((line, index) => ({
              sequence: index + 1,
              accountId: line.accountId,
              description: line.description,
              debit: new Prisma.Decimal(line.debit),
              credit: new Prisma.Decimal(line.credit),
              costCenterId: line.costCenterId,
              projectReference: line.projectReference,
            })),
          },
        },
        include: JOURNAL_INCLUDE,
      });
    });
  }

  async journals(query: PaginationQueryDto, user: AuthenticatedUser, pendingOnly = false) {
    await this.access.assertCanUseFinance(user);
    const where = pendingOnly ? { status: JournalStatus.PENDING_APPROVAL } : {};
    const [items, total] = await this.prisma.$transaction([
      this.prisma.journalEntry.findMany({ where, include: JOURNAL_INCLUDE, orderBy: { entryDate: 'desc' }, skip: query.skip, take: query.limit }),
      this.prisma.journalEntry.count({ where }),
    ]);
    return { items, total, page: query.page, limit: query.limit };
  }

  async updateJournal(
    id: string,
    dto: CreateJournalDto,
    user: AuthenticatedUser,
  ) {
    await this.access.assertCanUseFinance(user);
    const current = await this.findJournal(id);
    if (
      current.status !== JournalStatus.DRAFT &&
      current.status !== JournalStatus.REJECTED
    ) {
      throw new BadRequestException(
        'Only a draft or rejected journal can be edited',
      );
    }
    this.validateLines(dto.lines);
    const entryDate = this.utcDay(dto.entryDate);
    const period = await this.findOpenPeriod(entryDate);
    const accounts = await this.prisma.ledgerAccount.findMany({
      where: {
        id: { in: dto.lines.map((line) => line.accountId) },
        isActive: true,
      },
    });
    if (
      accounts.length !==
      new Set(dto.lines.map((line) => line.accountId)).size
    ) {
      throw new BadRequestException(
        'Every journal line must reference an active ledger account',
      );
    }
    return this.prisma.$transaction(async (tx) => {
      await tx.journalLine.deleteMany({ where: { journalId: id } });
      return tx.journalEntry.update({
        where: { id },
        data: {
          entryDate,
          periodId: period.id,
          description: dto.description,
          reference: dto.reference,
          status: JournalStatus.DRAFT,
          rejectedById: null,
          rejectedAt: null,
          rejectionComment: null,
          lines: {
            create: dto.lines.map((line, index) => ({
              sequence: index + 1,
              accountId: line.accountId,
              description: line.description,
              debit: new Prisma.Decimal(line.debit),
              credit: new Prisma.Decimal(line.credit),
              costCenterId: line.costCenterId,
              projectReference: line.projectReference,
            })),
          },
        },
        include: JOURNAL_INCLUDE,
      });
    });
  }

  async journal(id: string, user: AuthenticatedUser) {
    await this.access.assertCanUseFinance(user);
    return this.findJournal(id);
  }

  async submitJournal(id: string, user: AuthenticatedUser) {
    await this.access.assertCanUseFinance(user);
    const journal = await this.findJournal(id);
    if (
      journal.status !== JournalStatus.DRAFT &&
      journal.status !== JournalStatus.REJECTED
    ) {
      throw new BadRequestException('Only a draft or rejected journal can be submitted');
    }
    this.validateLines(journal.lines.map((line) => ({ debit: Number(line.debit), credit: Number(line.credit) })));
    return this.prisma.journalEntry.update({
      where: { id },
      data: { status: JournalStatus.PENDING_APPROVAL, submittedById: user.id, submittedAt: new Date(), rejectedById: null, rejectedAt: null, rejectionComment: null },
      include: JOURNAL_INCLUDE,
    });
  }

  async approveJournal(id: string, user: AuthenticatedUser) {
    await this.access.assertAccountsHead(user);
    const journal = await this.findJournal(id);
    if (journal.status !== JournalStatus.PENDING_APPROVAL) throw new BadRequestException('Only a pending journal can be approved');
    if (journal.createdById === user.id) throw new BadRequestException('The Finance Head cannot approve a journal they created');
    const period = await this.prisma.accountingPeriod.findUnique({ where: { id: journal.periodId } });
    if (period?.status !== AccountingPeriodStatus.OPEN) throw new BadRequestException('The accounting period is not open');
    return this.prisma.journalEntry.update({
      where: { id },
      data: { status: JournalStatus.POSTED, approvedById: user.id, approvedAt: new Date() },
      include: JOURNAL_INCLUDE,
    });
  }

  async rejectJournal(id: string, comment: string, user: AuthenticatedUser) {
    await this.access.assertAccountsHead(user);
    const journal = await this.findJournal(id);
    if (journal.status !== JournalStatus.PENDING_APPROVAL) throw new BadRequestException('Only a pending journal can be rejected');
    return this.prisma.journalEntry.update({
      where: { id },
      data: { status: JournalStatus.REJECTED, rejectedById: user.id, rejectedAt: new Date(), rejectionComment: comment },
      include: JOURNAL_INCLUDE,
    });
  }

  async reverseJournal(id: string, user: AuthenticatedUser) {
    await this.access.assertAccountsHead(user);
    const original = await this.findJournal(id);
    if (original.status !== JournalStatus.POSTED) throw new BadRequestException('Only a posted journal can be reversed');
    const period = await this.findOpenPeriod(this.utcDay(new Date().toISOString()));
    return this.prisma.$transaction(async (tx) => {
      const year = new Date().getUTCFullYear();
      const seq = await tx.financeSequence.upsert({
        where: { entity_year: { entity: 'JOURNAL', year } },
        create: { entity: 'JOURNAL', year, lastValue: 1 },
        update: { lastValue: { increment: 1 } },
      });
      const reversal = await tx.journalEntry.create({
        data: {
          journalNumber: `JV-${year}-${String(seq.lastValue).padStart(5, '0')}`,
          entryDate: this.utcDay(new Date().toISOString()), periodId: period.id,
          description: `Reversal of ${original.journalNumber}: ${original.description}`,
          reference: original.journalNumber, status: JournalStatus.POSTED,
          createdById: user.id, submittedById: user.id, submittedAt: new Date(),
          approvedById: user.id, approvedAt: new Date(), reversalOfId: original.id,
          lines: { create: original.lines.map((line) => ({ sequence: line.sequence, accountId: line.accountId, description: line.description, debit: line.credit, credit: line.debit, costCenterId: line.costCenterId, projectReference: line.projectReference })) },
        },
        include: JOURNAL_INCLUDE,
      });
      await tx.journalEntry.update({ where: { id }, data: { status: JournalStatus.REVERSED, reversedById: user.id, reversedAt: new Date() } });
      return reversal;
    });
  }

  async trialBalance(query: ReportQueryDto, user: AuthenticatedUser) {
    await this.access.assertCanUseFinance(user);
    const lines = await this.reportLines(query);
    const map = new Map<string, { accountId: string; code: string; name: string; accountType: AccountType; debit: Prisma.Decimal; credit: Prisma.Decimal }>();
    for (const line of lines) {
      const row = map.get(line.accountId) ?? { accountId: line.accountId, code: line.account.code, name: line.account.name, accountType: line.account.accountType, debit: new Prisma.Decimal(0), credit: new Prisma.Decimal(0) };
      row.debit = row.debit.plus(line.debit); row.credit = row.credit.plus(line.credit); map.set(line.accountId, row);
    }
    return [...map.values()].sort((a, b) => a.code.localeCompare(b.code)).map((row) => ({ ...row, debit: row.debit.toString(), credit: row.credit.toString(), balance: row.debit.minus(row.credit).toString() }));
  }

  async profitAndLoss(query: ReportQueryDto, user: AuthenticatedUser) {
    const trial = await this.trialBalance(query, user);
    const pnlTypes = new Set<AccountType>([AccountType.REVENUE, AccountType.COST_OF_GOODS_SOLD, AccountType.EXPENSE, AccountType.OTHER_INCOME, AccountType.OTHER_EXPENSE]);
    const rows = trial.filter((row) => pnlTypes.has(row.accountType));
    const total = (types: AccountType[], creditNature: boolean) => rows.filter((r) => types.includes(r.accountType)).reduce((sum, r) => sum.plus(creditNature ? new Prisma.Decimal(r.credit).minus(r.debit) : new Prisma.Decimal(r.debit).minus(r.credit)), new Prisma.Decimal(0));
    const revenue = total([AccountType.REVENUE], true);
    const otherIncome = total([AccountType.OTHER_INCOME], true);
    const cogs = total([AccountType.COST_OF_GOODS_SOLD], false);
    const expenses = total([AccountType.EXPENSE], false);
    const otherExpenses = total([AccountType.OTHER_EXPENSE], false);
    return { from: query.from, to: query.to, revenue: revenue.toString(), costOfGoodsSold: cogs.toString(), grossProfit: revenue.minus(cogs).toString(), operatingExpenses: expenses.toString(), otherIncome: otherIncome.toString(), otherExpenses: otherExpenses.toString(), profitBeforeTax: revenue.minus(cogs).minus(expenses).plus(otherIncome).minus(otherExpenses).toString(), accounts: rows };
  }

  async generalLedger(query: ReportQueryDto, user: AuthenticatedUser) {
    await this.access.assertCanUseFinance(user);
    return this.reportLines(query);
  }

  /**
   * Tally-style Day Book: a chronological register spanning EVERY voucher type
   * (sales, purchase, receipt, payment, journal), newest first. Read-only —
   * a union projection over the existing subledger + journal tables, no new
   * storage. Each row carries a `detailHref` so the UI can drill into the
   * voucher's own detail page. Defaults to today when from/to are omitted.
   */
  async daybook(query: DaybookQueryDto, user: AuthenticatedUser) {
    await this.access.assertCanUseFinance(user);
    const today = new Date().toISOString().slice(0, 10);
    const gte = this.utcDay(query.from ?? today);
    const lte = new Date(`${(query.to ?? today).slice(0, 10)}T23:59:59.999Z`);
    const within = { gte, lte };
    const type = query.voucherType;
    // Status filter is applied per source (each has its own status enum);
    // an unmatched status simply yields no rows for that source.
    const statusEq = query.status ? { equals: query.status as never } : undefined;

    type Row = {
      id: string;
      date: Date;
      voucherType: DaybookVoucherType;
      voucherNumber: string;
      party: string | null;
      amount: string;
      status: string;
      detailHref: string;
    };
    const rows: Row[] = [];

    if (!type || type === 'SALES') {
      const invoices = await this.prisma.salesInvoice.findMany({
        where: { invoiceDate: within, ...(statusEq ? { status: statusEq } : {}) },
        select: { id: true, invoiceNumber: true, invoiceDate: true, totalAmount: true, status: true, customer: { select: { name: true } } },
      });
      for (const inv of invoices)
        rows.push({ id: inv.id, date: inv.invoiceDate, voucherType: 'SALES', voucherNumber: inv.invoiceNumber, party: inv.customer?.name ?? null, amount: inv.totalAmount.toString(), status: inv.status, detailHref: '/finance/ar/invoices' });
    }

    if (!type || type === 'PURCHASE') {
      const bills = await this.prisma.accountsPayableInvoice.findMany({
        where: { invoiceDate: within, ...(statusEq ? { status: statusEq } : {}) },
        select: { id: true, internalBillNumber: true, invoiceDate: true, totalAmount: true, status: true, vendor: { select: { companyName: true } }, supplier: { select: { companyName: true } } },
      });
      for (const bill of bills)
        rows.push({ id: bill.id, date: bill.invoiceDate, voucherType: 'PURCHASE', voucherNumber: bill.internalBillNumber, party: bill.vendor?.companyName ?? bill.supplier?.companyName ?? null, amount: bill.totalAmount.toString(), status: bill.status, detailHref: '/finance/ap/invoices' });
    }

    if (!type || type === 'RECEIPT') {
      const receipts = await this.prisma.customerReceipt.findMany({
        where: { receiptDate: within, ...(statusEq ? { status: statusEq } : {}) },
        select: { id: true, receiptNumber: true, receiptDate: true, amount: true, status: true, customer: { select: { name: true } } },
      });
      for (const rct of receipts)
        rows.push({ id: rct.id, date: rct.receiptDate, voucherType: 'RECEIPT', voucherNumber: rct.receiptNumber, party: rct.customer?.name ?? null, amount: rct.amount.toString(), status: rct.status, detailHref: '/finance/ar/receipts' });
    }

    if (!type || type === 'PAYMENT') {
      // AP payments have no single voucherDate — use executedDate when the
      // payment has gone out, otherwise the plannedDate it's scheduled for.
      const payments = await this.prisma.accountsPayablePayment.findMany({
        where: { OR: [{ executedDate: within }, { executedDate: null, plannedDate: within }], ...(statusEq ? { status: statusEq } : {}) },
        select: { id: true, paymentNumber: true, plannedDate: true, executedDate: true, amount: true, status: true, vendor: { select: { companyName: true } }, supplier: { select: { companyName: true } } },
      });
      for (const pay of payments)
        rows.push({ id: pay.id, date: pay.executedDate ?? pay.plannedDate, voucherType: 'PAYMENT', voucherNumber: pay.paymentNumber, party: pay.vendor?.companyName ?? pay.supplier?.companyName ?? null, amount: pay.amount.toString(), status: pay.status, detailHref: '/finance/ap/payments' });
    }

    if (!type || type === 'JOURNAL') {
      // Only manual/standalone journals belong in the Day Book as JOURNAL
      // vouchers; subledger-posted journals already surface via their own
      // voucher rows above (they carry a back-relation to the source document).
      const journals = await this.prisma.journalEntry.findMany({
        where: { entryDate: within, ...(statusEq ? { status: statusEq } : {}), salesInvoice: null, apInvoice: null, customerReceipt: null, apPayment: null },
        select: { id: true, journalNumber: true, entryDate: true, description: true, status: true, lines: { select: { debit: true } } },
      });
      for (const jnl of journals) {
        const total = jnl.lines.reduce((sum, line) => sum.plus(line.debit), new Prisma.Decimal(0));
        rows.push({ id: jnl.id, date: jnl.entryDate, voucherType: 'JOURNAL', voucherNumber: jnl.journalNumber, party: jnl.description, amount: total.toString(), status: jnl.status, detailHref: '/finance/journals' });
      }
    }

    // Newest first; tiebreak by voucher number so same-day rows are stable.
    rows.sort((a, b) => b.date.getTime() - a.date.getTime() || b.voucherNumber.localeCompare(a.voucherNumber));
    return { from: gte.toISOString().slice(0, 10), to: lte.toISOString().slice(0, 10), rows };
  }

  private async reportLines(query: ReportQueryDto) {
    return this.prisma.journalLine.findMany({
      where: { ...(query.accountId ? { accountId: query.accountId } : {}), journal: { status: JournalStatus.POSTED, entryDate: { gte: this.utcDay(query.from), lte: new Date(`${query.to.slice(0, 10)}T23:59:59.999Z`) } } },
      include: { account: true, costCenter: true, journal: true },
      orderBy: [{ journal: { entryDate: 'asc' } }, { journalId: 'asc' }, { sequence: 'asc' }],
    });
  }

  private validateLines(lines: Array<{ debit: number | Prisma.Decimal; credit: number | Prisma.Decimal }>) {
    let debits = new Prisma.Decimal(0); let credits = new Prisma.Decimal(0);
    for (const line of lines) {
      const debit = new Prisma.Decimal(line.debit); const credit = new Prisma.Decimal(line.credit);
      if (debit.gt(0) === credit.gt(0)) throw new BadRequestException('Each journal line must contain either a debit or a credit, but not both');
      debits = debits.plus(debit); credits = credits.plus(credit);
    }
    if (debits.lte(0) || !debits.equals(credits)) throw new BadRequestException('Journal debits and credits must be equal and greater than zero');
  }

  private async findOpenPeriod(date: Date) {
    const period = await this.prisma.accountingPeriod.findFirst({ where: { startsOn: { lte: date }, endsOn: { gte: date } } });
    if (!period) throw new BadRequestException('No accounting period exists for the entry date');
    if (period.status !== AccountingPeriodStatus.OPEN) throw new BadRequestException('The accounting period is not open');
    return period;
  }

  /**
   * THE single shared GL-posting helper. Every subledger posting (AR invoice/
   * receipt, AP invoice/payment, treasury FX/advances, management depreciation/
   * schedules, operations opening-balance, compliance TDS/adjustment) MUST post
   * through this — do NOT hand-roll `tx.journalEntry.create` inline (that was
   * the copy-pasted drift liability this consolidates). It, in one place:
   *   - resolves the OPEN accounting period for entryDate (throws if none/closed)
   *   - allocates the next shared JV-YYYY-##### number (financeSequence 'JOURNAL')
   *   - validates the lines are balanced (debits == credits > 0, one-sided each)
   *   - creates a POSTED JournalEntry carrying the maker-checker snapshot
   *
   * Subledger entries post directly as POSTED (their own document already went
   * through its submit→approve maker-checker); the manual-journal path
   * (createJournal) is separate and keeps its DRAFT→approve workflow.
   *
   * Must be called INSIDE the caller's transaction so the journal and the
   * document that references it commit atomically. Returns the created journal.
   */
  async postJournalTx(
    tx: Prisma.TransactionClient,
    params: {
      entryDate: Date;
      description: string;
      reference?: string | null;
      createdById: string;
      submittedById?: string | null;
      submittedAt?: Date | null;
      approvedById: string;
      /** Defaults to now; pass to preserve a document's own approval timestamp. */
      approvedAt?: Date | null;
      lines: Array<{
        accountId: string;
        debit: Prisma.Decimal | number;
        credit: Prisma.Decimal | number;
        description?: string | null;
        costCenterId?: string | null;
        projectReference?: string | null;
      }>;
    },
  ) {
    // Only lines that actually carry an amount (mirrors the old inline filter).
    const lines = params.lines.filter(
      (l) => new Prisma.Decimal(l.debit).gt(0) || new Prisma.Decimal(l.credit).gt(0),
    );
    this.validateLines(lines);

    const period = await tx.accountingPeriod.findFirst({
      where: { startsOn: { lte: params.entryDate }, endsOn: { gte: params.entryDate } },
    });
    if (!period) throw new BadRequestException('No accounting period exists for the entry date');
    if (period.status !== AccountingPeriodStatus.OPEN) throw new BadRequestException('The accounting period is not open');

    const year = params.entryDate.getUTCFullYear();
    const seq = await tx.financeSequence.upsert({
      where: { entity_year: { entity: 'JOURNAL', year } },
      create: { entity: 'JOURNAL', year, lastValue: 1 },
      update: { lastValue: { increment: 1 } },
    });
    const journalNumber = `JV-${year}-${String(seq.lastValue).padStart(5, '0')}`;

    return tx.journalEntry.create({
      data: {
        journalNumber,
        entryDate: params.entryDate,
        periodId: period.id,
        description: params.description,
        reference: params.reference ?? null,
        status: JournalStatus.POSTED,
        createdById: params.createdById,
        submittedById: params.submittedById ?? null,
        submittedAt: params.submittedAt ?? null,
        approvedById: params.approvedById,
        approvedAt: params.approvedAt ?? new Date(),
        lines: {
          create: lines.map((l, i) => ({
            sequence: i + 1,
            accountId: l.accountId,
            description: l.description ?? null,
            debit: new Prisma.Decimal(l.debit),
            credit: new Prisma.Decimal(l.credit),
            costCenterId: l.costCenterId ?? null,
            projectReference: l.projectReference ?? null,
          })),
        },
      },
    });
  }

  private async findJournal(id: string) {
    const journal = await this.prisma.journalEntry.findUnique({ where: { id }, include: JOURNAL_INCLUDE });
    if (!journal) throw new NotFoundException('Journal entry not found');
    return journal;
  }

  private async assertAccount(id: string) {
    if (!(await this.prisma.ledgerAccount.findUnique({ where: { id } }))) throw new NotFoundException('Ledger account not found');
  }

  private utcDay(value: string) { return new Date(`${value.slice(0, 10)}T00:00:00.000Z`); }
}
