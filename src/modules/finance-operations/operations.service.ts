import { createHash } from 'crypto';
import { ConfigService } from '@nestjs/config';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  ApPaymentStatus,
  BankLineResolution,
  BankMatchType,
  BankStatementStatus,
  JournalStatus,
  Prisma,
  ReceiptStatus,
} from '@prisma/client';
import { AuthenticatedUser } from '../../common/decorators/current-user.decorator';
import { PaginationQueryDto } from '../../common/dto/pagination.dto';
import { PrismaService } from '../../core/database/prisma.service';
import { FinanceAccessService } from '../finance/finance-access.service';
import {
  AcceptUnmatchedDto,
  CreateBankAccountDto,
  ImportBankStatementDto,
  MatchBankLineDto,
  OpeningBalanceImportDto,
  OperationsRangeDto,
  ProductionSettingsDto,
} from './dto/operations.dto';

const STATEMENT_INCLUDE = {
  bankAccount: true,
  importedBy: { select: { id: true, firstName: true, lastName: true } },
  approvedBy: { select: { id: true, firstName: true, lastName: true } },
  lines: {
    orderBy: { sequence: 'asc' as const },
    include: {
      match: {
        include: {
          customerReceipt: { include: { customer: true } },
          apPayment: { include: { supplier: true, vendor: true } },
          journalEntry: true,
        },
      },
    },
  },
};

type ParsedLine = {
  transactionDate: Date;
  valueDate?: Date;
  description: string;
  bankReference?: string;
  debitAmount: Prisma.Decimal;
  creditAmount: Prisma.Decimal;
  runningBalance?: Prisma.Decimal;
};

@Injectable()
export class OperationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: FinanceAccessService,
    private readonly config: ConfigService,
  ) {}

  async productionSettings(user: AuthenticatedUser) {
    await this.access.assertCanUseFinance(user);
    return this.prisma.financeProductionSettings.upsert({
      where: { id: 'INDIA' }, create: { id: 'INDIA' }, update: {},
    });
  }
  async saveProductionSettings(dto: ProductionSettingsDto, user: AuthenticatedUser) {
    await this.access.assertAccountsHead(user);
    if (dto.gstMaxAttempts < 1 || dto.gstMaxAttempts > 20)
      throw new BadRequestException('GST maximum attempts must be between 1 and 20');
    if (dto.gstRetryDelayMinutes < 1 || dto.gstRetryDelayMinutes > 1440)
      throw new BadRequestException('GST retry delay must be between 1 and 1440 minutes');
    const codes = Object.values(dto.controlAccountMap).filter(Boolean);
    const active = await this.prisma.ledgerAccount.count({ where: { code: { in: codes }, isActive: true } });
    if (active !== new Set(codes).size)
      throw new BadRequestException('Every mapped control account must be an active ledger account');
    return this.prisma.financeProductionSettings.upsert({
      where: { id: 'INDIA' },
      create: { id: 'INDIA', ...dto, updatedById: user.id },
      update: { ...dto, updatedById: user.id },
    });
  }
  async productionReadiness(user: AuthenticatedUser) {
    await this.access.assertCanUseFinance(user);
    const [company, settings, unclassified, openFailed, accounts] = await Promise.all([
      this.prisma.financeCompanySettings.findUnique({ where: { id: 'INDIA' } }),
      this.productionSettings(user),
      this.prisma.ledgerAccount.count({ where: { isActive: true, cashFlowCategory: null } }),
      this.prisma.gstSubmission.count({ where: { status: 'FAILED' } }),
      this.prisma.ledgerAccount.count({ where: { isActive: true } }),
    ]);
    const gstConfigured = !!this.config.get<string>('gst.gatewayUrl') && !!this.config.get<string>('gst.gatewayToken');
    const checks = [
      { key: 'company', label: 'Finance company and GST settings', ok: !!company },
      { key: 'accounts', label: 'Active chart of accounts', ok: accounts > 0, detail: `${accounts} active` },
      { key: 'cashFlow', label: 'Cash-flow classifications complete', ok: unclassified === 0, detail: `${unclassified} unclassified` },
      { key: 'gst', label: 'GST provider configured (deferred by decision)', ok: gstConfigured, deferred: !gstConfigured },
      { key: 'gstFailures', label: 'No unresolved GST submission failures', ok: openFailed === 0, detail: `${openFailed} failed` },
      { key: 'email', label: 'Scheduled email delivery configured', ok: settings.emailDeliveryEnabled, deferred: !settings.emailDeliveryEnabled },
    ];
    const blocking = checks.filter((x) => !x.ok && !x.deferred);
    return this.prisma.financeReadinessRun.create({
      data: { status: blocking.length ? 'ACTION_REQUIRED' : 'READY', checks, runById: user.id },
    });
  }
  async imports(user: AuthenticatedUser) {
    await this.access.assertCanUseFinance(user);
    return this.prisma.financeImportBatch.findMany({ orderBy: { createdAt: 'desc' }, take: 50 });
  }
  async importOpeningBalances(dto: OpeningBalanceImportDto, user: AuthenticatedUser) {
    await this.access.assertCanUseFinance(user);
    const hash = createHash('sha256').update(dto.csvText).digest('hex');
    if (await this.prisma.financeImportBatch.findUnique({ where: { sourceChecksum: hash } }))
      throw new ConflictException('This opening-balance file has already been imported');
    const rows = this.parseOpeningCsv(dto.csvText);
    const debit = rows.reduce((s, x) => s.plus(x.debit), new Prisma.Decimal(0));
    const credit = rows.reduce((s, x) => s.plus(x.credit), new Prisma.Decimal(0));
    if (!debit.equals(credit) || debit.isZero())
      throw new BadRequestException(`Opening balances must be non-zero and balanced; debit ${debit.toFixed(2)}, credit ${credit.toFixed(2)}`);
    const codes = [...new Set(rows.map((x) => x.accountCode))];
    const accounts = await this.prisma.ledgerAccount.findMany({ where: { code: { in: codes }, isActive: true } });
    if (accounts.length !== codes.length) throw new BadRequestException('CSV contains an unknown or inactive ledger account code');
    const date = this.day(dto.entryDate), period = await this.prisma.accountingPeriod.findFirst({ where: { startsOn: { lte: date }, endsOn: { gte: date }, status: 'OPEN' } });
    if (!period) throw new BadRequestException('Entry date must belong to an open accounting period');
    const byCode = new Map(accounts.map((x) => [x.code, x]));
    return this.prisma.$transaction(async (tx) => {
      const number = await this.number(tx, 'OPENING_IMPORT', 'OB', date.getUTCFullYear());
      const journal = await tx.journalEntry.create({ data: { journalNumber: number, entryDate: date, periodId: period.id, description: `Opening balances imported from ${dto.sourceFileName}`, reference: `IMPORT:${hash.slice(0, 12)}`, createdById: user.id, lines: { create: rows.map((x, i) => ({ sequence: i + 1, accountId: byCode.get(x.accountCode)!.id, description: x.description, debit: x.debit, credit: x.credit })) } } });
      const batch = await tx.financeImportBatch.create({ data: { kind: 'OPENING_BALANCES', sourceFileName: dto.sourceFileName, sourceChecksum: hash, rowCount: rows.length, journalEntryId: journal.id, createdById: user.id } });
      return { batch, journal };
    });
  }
  async managementPackCsv(id: string, user: AuthenticatedUser) {
    await this.access.assertCanViewFinance(user);
    const pack = await this.prisma.managementReportPack.findUnique({ where: { id } });
    if (!pack) throw new NotFoundException('Management pack not found');
    const rows: string[] = ['section,metric,value'];
    const walk = (section: string, value: any) => Object.entries(value ?? {}).forEach(([k, v]) => typeof v === 'object' && v !== null ? walk(`${section}.${k}`, v) : rows.push([section, k, String(v ?? '')].map(this.csv).join(',')));
    walk('pack', pack.snapshot);
    return { fileName: `${pack.packNumber}.csv`, contentType: 'text/csv', content: rows.join('\n') };
  }
  private parseOpeningCsv(text: string) {
    const lines = text.trim().split(/\r?\n/); const headers = lines.shift()?.split(',').map((x) => x.trim().toLowerCase()) ?? [];
    for (const h of ['account_code', 'debit', 'credit']) if (!headers.includes(h)) throw new BadRequestException(`Missing CSV header ${h}`);
    const at = (cells: string[], h: string) => cells[headers.indexOf(h)]?.trim() ?? '';
    return lines.filter((x) => x.trim()).map((line, i) => { const cells = line.split(','); const debit = new Prisma.Decimal(at(cells, 'debit') || 0), credit = new Prisma.Decimal(at(cells, 'credit') || 0); if (debit.lt(0) || credit.lt(0) || (debit.gt(0) === credit.gt(0))) throw new BadRequestException(`Row ${i + 2} must contain either a positive debit or credit`); return { accountCode: at(cells, 'account_code'), description: at(cells, 'description'), debit, credit }; });
  }
  private csv(value: unknown) { return `"${String(value).replace(/"/g, '""')}"`; }

  async bankAccounts(user: AuthenticatedUser) {
    await this.access.assertCanUseFinance(user);
    return this.prisma.financeBankAccount.findMany({
      include: { ledgerAccount: true },
      orderBy: { accountName: 'asc' },
    });
  }
  async createBankAccount(dto: CreateBankAccountDto, user: AuthenticatedUser) {
    await this.access.assertAccountsHead(user);
    if (!/^\d{4}$/.test(dto.accountNumberLast4))
      throw new BadRequestException(
        'Account number must contain exactly the last four digits',
      );
    const ledger = await this.prisma.ledgerAccount.findUnique({
      where: { id: dto.ledgerAccountId },
    });
    if (!ledger || !ledger.isActive)
      throw new BadRequestException('Select an active bank ledger account');
    return this.prisma.financeBankAccount.create({
      data: {
        ...dto,
        accountNumberLast4: dto.accountNumberLast4,
        currencyCode: 'INR',
        createdById: user.id,
      },
    });
  }

  async importStatement(dto: ImportBankStatementDto, user: AuthenticatedUser) {
    await this.access.assertCanUseFinance(user);
    const bank = await this.prisma.financeBankAccount.findUnique({
      where: { id: dto.bankAccountId },
    });
    if (!bank?.isActive)
      throw new BadRequestException('Bank account is inactive or unavailable');
    const lines = this.parseCsv(dto.csvText);
    if (!lines.length)
      throw new BadRequestException('Statement contains no transaction rows');
    const from = this.day(dto.periodFrom),
      to = this.endDay(dto.periodTo);
    if (to < from) throw new BadRequestException('Statement period is invalid');
    if (lines.some((l) => l.transactionDate < from || l.transactionDate > to))
      throw new BadRequestException(
        'Every transaction date must fall within the statement period',
      );
    const opening = new Prisma.Decimal(dto.openingBalance),
      closing = new Prisma.Decimal(dto.closingBalance),
      calculated = lines
        .reduce((b, l) => b.plus(l.creditAmount).minus(l.debitAmount), opening)
        .toDecimalPlaces(2);
    if (!calculated.equals(closing))
      throw new BadRequestException(
        `Statement does not balance: calculated closing balance is ${calculated.toFixed(2)}`,
      );
    const hash = createHash('sha256')
      .update(`${dto.bankAccountId}|${dto.csvText}`)
      .digest('hex');
    if (
      await this.prisma.bankStatement.findUnique({
        where: { sourceFileHash: hash },
      })
    )
      throw new ConflictException(
        'This statement file has already been imported',
      );
    const statement = await this.prisma.$transaction(async (tx) => {
      const number = await this.number(
        tx,
        'BANK_STATEMENT',
        'BRS',
        from.getUTCFullYear(),
      );
      return tx.bankStatement.create({
        data: {
          statementNumber: number,
          bankAccountId: dto.bankAccountId,
          periodFrom: from,
          periodTo: to,
          openingBalance: opening,
          closingBalance: closing,
          sourceFileName: dto.sourceFileName,
          sourceFileHash: hash,
          importedById: user.id,
          lines: { create: lines.map((l, i) => ({ ...l, sequence: i + 1 })) },
        },
      });
    });
    await this.suggestMatches(statement.id);
    return this.statement(statement.id, user);
  }

  async statements(q: PaginationQueryDto, user: AuthenticatedUser) {
    await this.access.assertCanUseFinance(user);
    const [items, total] = await this.prisma.$transaction([
      this.prisma.bankStatement.findMany({
        include: { bankAccount: true, _count: { select: { lines: true } } },
        orderBy: { periodTo: 'desc' },
        skip: q.skip,
        take: q.limit,
      }),
      this.prisma.bankStatement.count(),
    ]);
    return { items, total, page: q.page, limit: q.limit };
  }
  async statement(id: string, user: AuthenticatedUser) {
    await this.access.assertCanUseFinance(user);
    const row = await this.prisma.bankStatement.findUnique({
      where: { id },
      include: STATEMENT_INCLUDE,
    });
    if (!row) throw new NotFoundException('Bank statement not found');
    return row;
  }
  async candidates(lineId: string, user: AuthenticatedUser) {
    await this.access.assertCanUseFinance(user);
    const line = await this.line(lineId);
    const start = new Date(line.transactionDate.getTime() - 7 * 86400000),
      end = new Date(line.transactionDate.getTime() + 7 * 86400000);
    const [receipts, payments, journals] = await Promise.all([
      line.creditAmount.gt(0)
        ? this.prisma.customerReceipt.findMany({
            where: {
              status: ReceiptStatus.POSTED,
              receiptDate: { gte: start, lte: end },
              amount: line.creditAmount,
              bankMatches: { none: {} },
            },
            include: { customer: true },
            take: 20,
          })
        : [],
      line.debitAmount.gt(0)
        ? this.prisma.accountsPayablePayment.findMany({
            where: {
              status: ApPaymentStatus.EXECUTED,
              executedDate: { gte: start, lte: end },
              amount: line.debitAmount,
              bankMatches: { none: {} },
            },
            include: { supplier: true, vendor: true },
            take: 20,
          })
        : [],
      this.prisma.journalEntry.findMany({
        where: {
          status: JournalStatus.POSTED,
          entryDate: { gte: start, lte: end },
          OR: [
            {
              reference: {
                contains: line.bankReference || '__NO_REFERENCE__',
                mode: 'insensitive',
              },
            },
            {
              journalNumber: {
                contains: line.bankReference || '__NO_REFERENCE__',
                mode: 'insensitive',
              },
            },
          ],
        },
        take: 20,
      }),
    ]);
    return { receipts, payments, journals };
  }

  async matchLine(
    lineId: string,
    dto: MatchBankLineDto,
    user: AuthenticatedUser,
  ) {
    await this.access.assertCanUseFinance(user);
    const line = await this.line(lineId);
    this.assertDraft(line.statement.status);
    const expected = await this.targetAmount(
      dto.matchType,
      dto.transactionId,
      line.creditAmount.gt(0) ? line.creditAmount : line.debitAmount,
    );
    if (
      !new Prisma.Decimal(expected).equals(
        line.creditAmount.gt(0) ? line.creditAmount : line.debitAmount,
      )
    )
      throw new BadRequestException(
        'Selected transaction amount does not match the bank line',
      );
    return this.prisma.$transaction(async (tx) => {
      await tx.bankTransactionMatch.upsert({
        where: { statementLineId: lineId },
        create: {
          statementLineId: lineId,
          matchType: dto.matchType,
          ...this.targetIds(dto),
          confidenceScore: 100,
          matchReason: 'Manually confirmed exact amount',
          confirmedById: user.id,
          confirmedAt: new Date(),
        },
        update: {
          matchType: dto.matchType,
          ...this.targetIds(dto),
          confidenceScore: 100,
          matchReason: 'Manually confirmed exact amount',
          confirmedById: user.id,
          confirmedAt: new Date(),
        },
      });
      return tx.bankStatementLine.update({
        where: { id: lineId },
        data: { resolution: BankLineResolution.MATCHED, exceptionReason: null },
        include: { match: true },
      });
    });
  }
  async confirmSuggestion(lineId: string, user: AuthenticatedUser) {
    await this.access.assertCanUseFinance(user);
    const line = await this.line(lineId);
    this.assertDraft(line.statement.status);
    if (!line.match) throw new BadRequestException('No suggested match exists');
    return this.prisma.$transaction(async (tx) => {
      await tx.bankTransactionMatch.update({
        where: { statementLineId: lineId },
        data: { confirmedById: user.id, confirmedAt: new Date() },
      });
      return tx.bankStatementLine.update({
        where: { id: lineId },
        data: { resolution: BankLineResolution.MATCHED },
        include: { match: true },
      });
    });
  }
  async acceptUnmatched(
    lineId: string,
    dto: AcceptUnmatchedDto,
    user: AuthenticatedUser,
  ) {
    await this.access.assertCanUseFinance(user);
    if (!dto.reason?.trim())
      throw new BadRequestException(
        'An unmatched exception reason is required',
      );
    const line = await this.line(lineId);
    this.assertDraft(line.statement.status);
    return this.prisma.$transaction(async (tx) => {
      await tx.bankTransactionMatch.deleteMany({
        where: { statementLineId: lineId },
      });
      return tx.bankStatementLine.update({
        where: { id: lineId },
        data: {
          resolution: BankLineResolution.UNMATCHED_ACCEPTED,
          exceptionReason: dto.reason,
        },
      });
    });
  }
  async submitStatement(id: string, user: AuthenticatedUser) {
    await this.access.assertCanUseFinance(user);
    const s = await this.statement(id, user);
    this.assertDraft(s.status);
    if (s.lines.some((l) => l.resolution === BankLineResolution.PENDING))
      throw new BadRequestException(
        'Resolve every bank line before submission',
      );
    return this.prisma.bankStatement.update({
      where: { id },
      data: {
        status: BankStatementStatus.PENDING_APPROVAL,
        submittedById: user.id,
        submittedAt: new Date(),
        rejectionComment: null,
      },
    });
  }
  async approveStatement(id: string, user: AuthenticatedUser) {
    await this.access.assertAccountsHead(user);
    const s = await this.statement(id, user);
    if (s.status !== BankStatementStatus.PENDING_APPROVAL)
      throw new BadRequestException('Statement is not pending approval');
    if (s.importedById === user.id)
      throw new BadRequestException(
        'Finance Head cannot approve a statement they imported',
      );
    return this.prisma.bankStatement.update({
      where: { id },
      data: {
        status: BankStatementStatus.APPROVED,
        approvedById: user.id,
        approvedAt: new Date(),
      },
    });
  }
  async rejectStatement(id: string, comment: string, user: AuthenticatedUser) {
    await this.access.assertAccountsHead(user);
    const s = await this.statement(id, user);
    if (s.status !== BankStatementStatus.PENDING_APPROVAL)
      throw new BadRequestException('Statement is not pending approval');
    return this.prisma.bankStatement.update({
      where: { id },
      data: { status: BankStatementStatus.REJECTED, rejectionComment: comment },
    });
  }

  async exportData(
    kind: string,
    range: OperationsRangeDto,
    user: AuthenticatedUser,
  ) {
    await this.access.assertCanUseFinance(user);
    const dates = { gte: this.day(range.from), lte: this.endDay(range.to) };
    switch (kind) {
      case 'general-ledger': {
        const rows = await this.prisma.journalLine.findMany({
          where: {
            journal: { entryDate: dates, status: JournalStatus.POSTED },
          },
          include: { journal: true, account: true, costCenter: true },
          orderBy: [{ journal: { entryDate: 'asc' } }, { sequence: 'asc' }],
        });
        return rows.map((r) => ({
          date: r.journal.entryDate,
          journalNumber: r.journal.journalNumber,
          reference: r.journal.reference,
          description: r.description ?? r.journal.description,
          accountCode: r.account.code,
          accountName: r.account.name,
          debit: r.debit.toString(),
          credit: r.credit.toString(),
          costCenter: r.costCenter?.code,
          projectReference: r.projectReference,
        }));
      }
      case 'ar-aging': {
        const rows = await this.prisma.salesInvoice.findMany({
          where: { invoiceDate: dates },
          include: { customer: true },
          orderBy: { invoiceDate: 'asc' },
        });
        return rows.map((i) => ({
          invoiceNumber: i.invoiceNumber,
          invoiceDate: i.invoiceDate,
          dueDate: i.dueDate,
          customer: i.customer.name,
          currency: i.currencyCode,
          total: i.totalAmount.toString(),
          paid: i.paidAmount.toString(),
          outstanding: i.outstandingAmount.toString(),
          status: i.status,
        }));
      }
      case 'ap-aging': {
        const rows = await this.prisma.accountsPayableInvoice.findMany({
          where: { invoiceDate: dates },
          include: { supplier: true, vendor: true },
          orderBy: { invoiceDate: 'asc' },
        });
        return rows.map((i) => ({
          billNumber: i.internalBillNumber,
          supplierInvoice: i.externalInvoiceNumber,
          invoiceDate: i.invoiceDate,
          dueDate: i.dueDate,
          party: i.supplier?.companyName ?? i.vendor?.companyName,
          currency: i.currencyCode,
          taxable: i.taxableAmount.toString(),
          inputCgst: i.inputCgstAmount.toString(),
          inputSgst: i.inputSgstAmount.toString(),
          inputIgst: i.inputIgstAmount.toString(),
          total: i.totalAmount.toString(),
          outstanding: i.outstandingAmount.toString(),
          itcStatus: i.itcStatus,
          paymentHold: i.paymentHold,
          status: i.status,
        }));
      }
      case 'bank-reconciliation': {
        const statements = await this.prisma.bankStatement.findMany({
          where: { periodTo: dates },
          include: STATEMENT_INCLUDE,
          orderBy: { periodTo: 'asc' },
        });
        return statements.flatMap((s) =>
          s.lines.map((l) => ({
            statementNumber: s.statementNumber,
            bankAccount: s.bankAccount.accountName,
            statementStatus: s.status,
            transactionDate: l.transactionDate,
            description: l.description,
            bankReference: l.bankReference,
            debit: l.debitAmount.toString(),
            credit: l.creditAmount.toString(),
            runningBalance: l.runningBalance?.toString(),
            resolution: l.resolution,
            exceptionReason: l.exceptionReason,
            matchType: l.match?.matchType,
            matchReason: l.match?.matchReason,
            matchConfirmedAt: l.match?.confirmedAt,
          })),
        );
      }
      default:
        throw new BadRequestException('Unsupported export type');
    }
  }
  async auditPack(range: OperationsRangeDto, user: AuthenticatedUser) {
    await this.access.assertCanUseFinance(user);
    const [ledger, ar, ap, bank, notes] = await Promise.all([
      this.exportData('general-ledger', range, user),
      this.exportData('ar-aging', range, user),
      this.exportData('ap-aging', range, user),
      this.exportData('bank-reconciliation', range, user),
      this.prisma.financeAdjustmentNote.findMany({
        where: {
          noteDate: { gte: this.day(range.from), lte: this.endDay(range.to) },
        },
        include: { salesInvoice: true, apInvoice: true },
        orderBy: { noteDate: 'asc' },
      }),
    ]);
    return {
      metadata: {
        generatedAt: new Date(),
        generatedBy: user.id,
        period: range,
        baseCurrency: 'INR',
      },
      generalLedger: ledger,
      accountsReceivable: ar,
      accountsPayable: ap,
      bankReconciliations: bank,
      adjustmentNotes: notes,
    };
  }

  parseCsv(text: string): ParsedLine[] {
    const rows = this.csvRows(text.replace(/^\uFEFF/, ''));
    if (rows.length < 2) return [];
    const headers = rows[0].map((h) =>
      h
        .trim()
        .toLowerCase()
        .replace(/[\s-]+/g, '_'),
    );
    const required = ['date', 'description', 'debit', 'credit'];
    for (const h of required)
      if (!headers.includes(h))
        throw new BadRequestException(`CSV header ${h} is required`);
    const at = (r: string[], h: string) => r[headers.indexOf(h)]?.trim();
    return rows
      .slice(1)
      .filter((r) => r.some(Boolean))
      .map((r, index) => {
        const date = this.csvDate(at(r, 'date'));
        const debit = this.money(at(r, 'debit')),
          credit = this.money(at(r, 'credit'));
        if ((debit.gt(0) && credit.gt(0)) || (debit.eq(0) && credit.eq(0)))
          throw new BadRequestException(
            `CSV row ${index + 2} must contain either debit or credit`,
          );
        return {
          transactionDate: date,
          valueDate: at(r, 'value_date')
            ? this.csvDate(at(r, 'value_date'))
            : undefined,
          description: at(r, 'description'),
          bankReference: at(r, 'reference') || undefined,
          debitAmount: debit,
          creditAmount: credit,
          runningBalance: at(r, 'balance')
            ? this.money(at(r, 'balance'))
            : undefined,
        };
      });
  }
  private csvRows(text: string) {
    const rows: string[][] = [];
    let row: string[] = [],
      field = '',
      quoted = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (c === '"') {
        if (quoted && text[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = !quoted;
      } else if (c === ',' && !quoted) {
        row.push(field);
        field = '';
      } else if ((c === '\n' || c === '\r') && !quoted) {
        if (c === '\r' && text[i + 1] === '\n') i++;
        row.push(field);
        if (row.some((v) => v.trim())) rows.push(row);
        row = [];
        field = '';
      } else field += c;
    }
    row.push(field);
    if (row.some((v) => v.trim())) rows.push(row);
    if (quoted)
      throw new BadRequestException('CSV contains an unclosed quoted field');
    return rows;
  }
  private async suggestMatches(statementId: string) {
    const lines = await this.prisma.bankStatementLine.findMany({
      where: { statementId },
    });
    for (const line of lines) {
      const ref = line.bankReference?.trim();
      if (!ref) continue;
      if (line.creditAmount.gt(0)) {
        const rows = await this.prisma.customerReceipt.findMany({
          where: {
            status: ReceiptStatus.POSTED,
            amount: line.creditAmount,
            bankReference: { equals: ref, mode: 'insensitive' },
            bankMatches: { none: {} },
          },
        });
        if (rows.length === 1)
          await this.prisma.bankTransactionMatch.create({
            data: {
              statementLineId: line.id,
              matchType: BankMatchType.CUSTOMER_RECEIPT,
              customerReceiptId: rows[0].id,
              confidenceScore: 100,
              matchReason: 'Exact bank reference and amount',
            },
          });
      } else {
        const rows = await this.prisma.accountsPayablePayment.findMany({
          where: {
            status: ApPaymentStatus.EXECUTED,
            amount: line.debitAmount,
            bankReference: { equals: ref, mode: 'insensitive' },
            bankMatches: { none: {} },
          },
        });
        if (rows.length === 1)
          await this.prisma.bankTransactionMatch.create({
            data: {
              statementLineId: line.id,
              matchType: BankMatchType.VENDOR_PAYMENT,
              apPaymentId: rows[0].id,
              confidenceScore: 100,
              matchReason: 'Exact bank reference and amount',
            },
          });
      }
    }
  }
  private targetIds(d: MatchBankLineDto) {
    return {
      customerReceiptId:
        d.matchType === BankMatchType.CUSTOMER_RECEIPT ? d.transactionId : null,
      apPaymentId:
        d.matchType === BankMatchType.VENDOR_PAYMENT ? d.transactionId : null,
      journalEntryId:
        d.matchType === BankMatchType.JOURNAL_ENTRY ? d.transactionId : null,
    };
  }
  private async targetAmount(
    type: BankMatchType,
    id: string,
    bankAmount: Prisma.Decimal,
  ) {
    if (type === BankMatchType.CUSTOMER_RECEIPT) {
      const receipt = await this.prisma.customerReceipt.findFirst({
        where: { id, status: ReceiptStatus.POSTED, bankMatches: { none: {} } },
      });
      if (!receipt) throw new BadRequestException('Posted receipt not found');
      return receipt.amount;
    }
    if (type === BankMatchType.VENDOR_PAYMENT) {
      const payment = await this.prisma.accountsPayablePayment.findFirst({
        where: {
          id,
          status: ApPaymentStatus.EXECUTED,
          bankMatches: { none: {} },
        },
      });
      if (!payment) throw new BadRequestException('Executed payment not found');
      return payment.amount;
    }
    const journal = await this.prisma.journalEntry.findFirst({
      where: { id, status: JournalStatus.POSTED, bankMatches: { none: {} } },
    });
    if (!journal) throw new BadRequestException('Posted journal not found');
    return bankAmount;
  }
  private async line(id: string) {
    const l = await this.prisma.bankStatementLine.findUnique({
      where: { id },
      include: { statement: true, match: true },
    });
    if (!l) throw new NotFoundException('Bank statement line not found');
    return l;
  }
  private assertDraft(status: BankStatementStatus) {
    if (
      ![BankStatementStatus.DRAFT, BankStatementStatus.REJECTED].includes(
        status as any,
      )
    )
      throw new BadRequestException(
        'Only a draft or rejected statement can be reconciled',
      );
  }
  private money(value: string) {
    const normalized = (value || '0')
      .replace(/[₹,$\s]/g, '')
      .replace(/^\((.*)\)$/, '-$1');
    const d = new Prisma.Decimal(normalized || 0);
    if (d.lt(0))
      throw new BadRequestException(
        'Statement debit and credit values cannot be negative',
      );
    return d.toDecimalPlaces(2);
  }
  private csvDate(value: string) {
    if (!value)
      throw new BadRequestException('CSV transaction date is required');
    const iso = /^\d{4}-\d{2}-\d{2}$/.test(value)
      ? value
      : value.match(/^\d{2}\/\d{2}\/\d{4}$/)
        ? `${value.slice(6)}-${value.slice(3, 5)}-${value.slice(0, 2)}`
        : '';
    const d = new Date(`${iso}T00:00:00.000Z`);
    if (!iso || Number.isNaN(d.getTime()))
      throw new BadRequestException(`Invalid CSV date ${value}`);
    return d;
  }
  private day(v: string) {
    return new Date(`${v.slice(0, 10)}T00:00:00.000Z`);
  }
  private endDay(v: string) {
    return new Date(`${v.slice(0, 10)}T23:59:59.999Z`);
  }
  private async number(
    tx: Prisma.TransactionClient,
    entity: string,
    prefix: string,
    year: number,
  ) {
    const s = await tx.financeSequence.upsert({
      where: { entity_year: { entity, year } },
      create: { entity, year, lastValue: 1 },
      update: { lastValue: { increment: 1 } },
    });
    return `${prefix}-${year}-${String(s.lastValue).padStart(5, '0')}`;
  }
}
