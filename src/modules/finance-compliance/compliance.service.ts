import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  AccountingPeriodStatus,
  ApInvoiceStatus,
  ApPaymentStatus,
  FinanceNoteSide,
  FinanceNoteStatus,
  FinanceNoteType,
  GstItcStatus,
  JournalStatus,
  PeriodCloseStatus,
  Prisma,
  SalesInvoiceStatus,
} from '@prisma/client';
import { AuthenticatedUser } from '../../common/decorators/current-user.decorator';
import { PaginationQueryDto } from '../../common/dto/pagination.dto';
import { PrismaService } from '../../core/database/prisma.service';
import { FinanceAccessService } from '../finance/finance-access.service';
import { FinanceService } from '../finance/finance.service';
import {
  CreateAdjustmentNoteDto,
  CreateTdsSectionDto,
  PreparePeriodCloseDto,
  ReportRangeDto,
  SetItcStatusDto,
  SetPaymentHoldDto,
} from './dto/compliance.dto';

const NOTE_INCLUDE = {
  salesInvoice: { include: { customer: true } },
  apInvoice: { include: { supplier: true, vendor: true } },
  createdBy: { select: { id: true, firstName: true, lastName: true } },
  approvedBy: { select: { id: true, firstName: true, lastName: true } },
};

@Injectable()
export class ComplianceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: FinanceAccessService,
    private readonly finance: FinanceService,
  ) {}

  async tdsSections(user: AuthenticatedUser) {
    await this.access.assertCanUseFinance(user);
    return this.prisma.tdsSection.findMany({
      orderBy: [{ sectionCode: 'asc' }, { effectiveFrom: 'desc' }],
    });
  }

  async createTdsSection(dto: CreateTdsSectionDto, user: AuthenticatedUser) {
    await this.access.assertAccountsHead(user);
    const from = this.day(dto.effectiveFrom);
    const to = dto.effectiveTo ? this.day(dto.effectiveTo) : undefined;
    if (to && to < from)
      throw new BadRequestException(
        'Effective-to date cannot precede effective-from',
      );
    return this.prisma.tdsSection.create({
      data: {
        sectionCode: dto.sectionCode.trim().toUpperCase(),
        description: dto.description.trim(),
        ratePercent: dto.ratePercent,
        thresholdInr: dto.thresholdInr ?? 0,
        effectiveFrom: from,
        effectiveTo: to,
        createdById: user.id,
      },
    });
  }

  async setTdsActive(id: string, isActive: boolean, user: AuthenticatedUser) {
    await this.access.assertAccountsHead(user);
    await this.requireTds(id);
    return this.prisma.tdsSection.update({ where: { id }, data: { isActive } });
  }

  async createNote(dto: CreateAdjustmentNoteDto, user: AuthenticatedUser) {
    await this.access.assertCanUseFinance(user);
    const tax = new Prisma.Decimal(dto.cgstAmount ?? 0)
      .plus(dto.sgstAmount ?? 0)
      .plus(dto.igstAmount ?? 0);
    const taxable = new Prisma.Decimal(dto.taxableAmount);
    const total = taxable.plus(tax).toDecimalPlaces(2);
    if (total.lte(0))
      throw new BadRequestException('Note total must be positive');
    const invoice = await this.resolveNoteInvoice(dto.side, dto.invoiceId);
    if (
      dto.noteType === FinanceNoteType.CREDIT_NOTE &&
      total.gt(invoice.outstandingAmount)
    )
      throw new BadRequestException(
        'Credit note cannot exceed invoice outstanding',
      );
    const date = this.day(dto.noteDate);
    return this.prisma.$transaction(async (tx) => {
      const noteNumber = await this.number(
        tx,
        'FINANCE_NOTE',
        dto.noteType === FinanceNoteType.CREDIT_NOTE ? 'CN' : 'DN',
        date.getUTCFullYear(),
      );
      return tx.financeAdjustmentNote.create({
        data: {
          noteNumber,
          side: dto.side,
          noteType: dto.noteType,
          noteDate: date,
          reason: dto.reason.trim(),
          salesInvoiceId:
            dto.side === FinanceNoteSide.ACCOUNTS_RECEIVABLE
              ? dto.invoiceId
              : undefined,
          apInvoiceId:
            dto.side === FinanceNoteSide.ACCOUNTS_PAYABLE
              ? dto.invoiceId
              : undefined,
          taxableAmount: taxable,
          cgstAmount: dto.cgstAmount ?? 0,
          sgstAmount: dto.sgstAmount ?? 0,
          igstAmount: dto.igstAmount ?? 0,
          totalAmount: total,
          createdById: user.id,
        },
        include: NOTE_INCLUDE,
      });
    });
  }

  async notes(q: PaginationQueryDto, user: AuthenticatedUser) {
    await this.access.assertCanUseFinance(user);
    const [items, total] = await this.prisma.$transaction([
      this.prisma.financeAdjustmentNote.findMany({
        include: NOTE_INCLUDE,
        orderBy: { noteDate: 'desc' },
        skip: q.skip,
        take: q.limit,
      }),
      this.prisma.financeAdjustmentNote.count(),
    ]);
    return { items, total, page: q.page, limit: q.limit };
  }

  async submitNote(id: string, user: AuthenticatedUser) {
    await this.access.assertCanUseFinance(user);
    const note = await this.requireNote(id);
    if (
      ![FinanceNoteStatus.DRAFT, FinanceNoteStatus.REJECTED].includes(
        note.status as any,
      )
    )
      throw new BadRequestException(
        'Only draft or rejected notes can be submitted',
      );
    return this.prisma.financeAdjustmentNote.update({
      where: { id },
      data: {
        status: FinanceNoteStatus.PENDING_APPROVAL,
        submittedById: user.id,
        submittedAt: new Date(),
        rejectionComment: null,
      },
      include: NOTE_INCLUDE,
    });
  }

  async rejectNote(id: string, comment: string, user: AuthenticatedUser) {
    await this.access.assertAccountsHead(user);
    const note = await this.requireNote(id);
    if (note.status !== FinanceNoteStatus.PENDING_APPROVAL)
      throw new BadRequestException('Note is not pending approval');
    return this.prisma.financeAdjustmentNote.update({
      where: { id },
      data: { status: FinanceNoteStatus.REJECTED, rejectionComment: comment },
      include: NOTE_INCLUDE,
    });
  }

  async approveNote(id: string, user: AuthenticatedUser) {
    await this.access.assertAccountsHead(user);
    const note = await this.requireNote(id);
    if (note.status !== FinanceNoteStatus.PENDING_APPROVAL)
      throw new BadRequestException('Note is not pending approval');
    if (note.createdById === user.id)
      throw new BadRequestException(
        'Finance Head cannot approve a note they created',
      );
    return this.postNote(note, user.id);
  }

  async setItcStatus(
    id: string,
    dto: SetItcStatusDto,
    user: AuthenticatedUser,
  ) {
    await this.access.assertCanUseFinance(user);
    const invoice = await this.prisma.accountsPayableInvoice.findUnique({
      where: { id },
    });
    if (!invoice) throw new NotFoundException('AP invoice not found');
    if (
      ![
        ApInvoiceStatus.APPROVED,
        ApInvoiceStatus.PARTIALLY_PAID,
        ApInvoiceStatus.PAID,
      ].includes(invoice.status as any)
    )
      throw new BadRequestException(
        'Only approved or paid invoices can be reconciled',
      );
    if (dto.status === GstItcStatus.MISMATCHED && !dto.note?.trim())
      throw new BadRequestException('A mismatch reason is required');
    return this.prisma.accountsPayableInvoice.update({
      where: { id },
      data: {
        itcStatus: dto.status,
        itcReconciliationNote: dto.note,
        itcReconciledAt: new Date(),
        itcReconciledById: user.id,
      },
    });
  }

  async setPaymentHold(
    id: string,
    dto: SetPaymentHoldDto,
    user: AuthenticatedUser,
  ) {
    await this.access.assertAccountsHead(user);
    if (dto.hold && !dto.reason?.trim())
      throw new BadRequestException('A payment-hold reason is required');
    const invoice = await this.prisma.accountsPayableInvoice.findUnique({
      where: { id },
    });
    if (!invoice) throw new NotFoundException('AP invoice not found');
    return this.prisma.accountsPayableInvoice.update({
      where: { id },
      data: {
        paymentHold: dto.hold,
        paymentHoldReason: dto.hold ? dto.reason : null,
        status: dto.hold
          ? ApInvoiceStatus.DISPUTED
          : invoice.outstandingAmount.gt(0)
            ? invoice.paidAmount.gt(0)
              ? ApInvoiceStatus.PARTIALLY_PAID
              : ApInvoiceStatus.APPROVED
            : ApInvoiceStatus.PAID,
      },
    });
  }

  async gstPurchaseRegister(range: ReportRangeDto, user: AuthenticatedUser) {
    await this.access.assertCanUseFinance(user);
    const invoices = await this.prisma.accountsPayableInvoice.findMany({
      where: {
        invoiceDate: { gte: this.day(range.from), lte: this.endDay(range.to) },
        status: {
          in: [
            ApInvoiceStatus.APPROVED,
            ApInvoiceStatus.PARTIALLY_PAID,
            ApInvoiceStatus.PAID,
            ApInvoiceStatus.DISPUTED,
          ],
        },
      },
      include: { supplier: true, vendor: true },
      orderBy: { invoiceDate: 'asc' },
    });
    return invoices.map((i) => ({
      invoiceId: i.id,
      internalBillNumber: i.internalBillNumber,
      supplierInvoiceNumber: i.externalInvoiceNumber,
      invoiceDate: i.invoiceDate,
      partyName: i.supplier?.companyName ?? i.vendor?.companyName,
      gstin: i.supplierGstinSnapshot,
      taxableAmount: i.taxableAmount.toString(),
      cgst: i.inputCgstAmount.toString(),
      sgst: i.inputSgstAmount.toString(),
      igst: i.inputIgstAmount.toString(),
      total: i.totalAmount.toString(),
      itcStatus: i.itcStatus,
      reconciliationNote: i.itcReconciliationNote,
    }));
  }

  async apAging(asOf: string, user: AuthenticatedUser) {
    await this.access.assertCanUseFinance(user);
    const date = this.endDay(asOf);
    const invoices = await this.prisma.accountsPayableInvoice.findMany({
      where: {
        invoiceDate: { lte: date },
        outstandingAmount: { gt: 0 },
        status: {
          in: [
            ApInvoiceStatus.APPROVED,
            ApInvoiceStatus.PARTIALLY_PAID,
            ApInvoiceStatus.DISPUTED,
          ],
        },
      },
      include: { supplier: true, vendor: true },
    });
    return invoices.map((i) => {
      const days = Math.max(
        0,
        Math.floor((date.getTime() - i.dueDate.getTime()) / 86400000),
      );
      return {
        invoiceId: i.id,
        billNumber: i.internalBillNumber,
        partyName: i.supplier?.companyName ?? i.vendor?.companyName,
        dueDate: i.dueDate,
        daysOverdue: days,
        outstanding: i.outstandingAmount.toString(),
        bucket:
          days === 0
            ? 'CURRENT'
            : days <= 30
              ? '1_30'
              : days <= 60
                ? '31_60'
                : days <= 90
                  ? '61_90'
                  : days <= 180
                    ? '91_180'
                    : 'OVER_180',
        onHold: i.paymentHold,
      };
    });
  }

  async cashForecast(range: ReportRangeDto, user: AuthenticatedUser) {
    await this.access.assertCanUseFinance(user);
    const from = this.day(range.from),
      to = this.endDay(range.to);
    const [ar, ap, payments] = await Promise.all([
      this.prisma.salesInvoice.findMany({
        where: {
          dueDate: { gte: from, lte: to },
          outstandingAmount: { gt: 0 },
          status: {
            in: [
              SalesInvoiceStatus.ISSUED,
              SalesInvoiceStatus.PARTIALLY_PAID,
              SalesInvoiceStatus.OVERDUE,
            ],
          },
        },
      }),
      this.prisma.accountsPayableInvoice.findMany({
        where: {
          dueDate: { gte: from, lte: to },
          outstandingAmount: { gt: 0 },
          paymentHold: false,
          status: {
            in: [ApInvoiceStatus.APPROVED, ApInvoiceStatus.PARTIALLY_PAID],
          },
        },
      }),
      this.prisma.accountsPayablePayment.findMany({
        where: {
          plannedDate: { gte: from, lte: to },
          status: {
            in: [ApPaymentStatus.PENDING_APPROVAL, ApPaymentStatus.APPROVED],
          },
        },
      }),
    ]);
    const weeks = new Map<
      string,
      {
        weekStarting: string;
        expectedCollections: Prisma.Decimal;
        duePayables: Prisma.Decimal;
        plannedPayments: Prisma.Decimal;
      }
    >();
    const row = (date: Date) => {
      const d = new Date(date);
      const day = (d.getUTCDay() + 6) % 7;
      d.setUTCDate(d.getUTCDate() - day);
      const key = d.toISOString().slice(0, 10);
      if (!weeks.has(key))
        weeks.set(key, {
          weekStarting: key,
          expectedCollections: new Prisma.Decimal(0),
          duePayables: new Prisma.Decimal(0),
          plannedPayments: new Prisma.Decimal(0),
        });
      return weeks.get(key)!;
    };
    ar.forEach((i) => {
      const r = row(i.dueDate);
      r.expectedCollections = r.expectedCollections.plus(
        i.outstandingAmount.times(i.exchangeRateToInr),
      );
    });
    ap.forEach((i) => {
      const r = row(i.dueDate);
      r.duePayables = r.duePayables.plus(
        i.outstandingAmount.times(i.exchangeRateToInr),
      );
    });
    payments.forEach((p) => {
      const r = row(p.plannedDate);
      r.plannedPayments = r.plannedPayments.plus(
        p.amount.times(p.exchangeRateToInr),
      );
    });
    return [...weeks.values()]
      .sort((a, b) => a.weekStarting.localeCompare(b.weekStarting))
      .map((r) => ({
        weekStarting: r.weekStarting,
        expectedCollections: r.expectedCollections.toString(),
        duePayables: r.duePayables.toString(),
        plannedPayments: r.plannedPayments.toString(),
        netCash: r.expectedCollections.minus(r.plannedPayments).toString(),
      }));
  }

  async prepareClose(
    periodId: string,
    dto: PreparePeriodCloseDto,
    user: AuthenticatedUser,
  ) {
    await this.access.assertCanUseFinance(user);
    const period = await this.prisma.accountingPeriod.findUnique({
      where: { id: periodId },
    });
    if (!period) throw new NotFoundException('Accounting period not found');
    if (period.status === AccountingPeriodStatus.CLOSED)
      throw new BadRequestException('Period is already closed');
    const blockers = await this.closeBlockers(period.startsOn, period.endsOn);
    return this.prisma.periodClose.upsert({
      where: { periodId },
      create: {
        periodId,
        checklist: { ...blockers, ...(dto.checklist ?? {}) },
        preparationNote: dto.preparationNote,
        preparedById: user.id,
      },
      update: {
        checklist: { ...blockers, ...(dto.checklist ?? {}) },
        preparationNote: dto.preparationNote,
        preparedById: user.id,
        status: PeriodCloseStatus.PREPARING,
      },
      include: { period: true },
    });
  }

  async submitClose(periodId: string, user: AuthenticatedUser) {
    await this.access.assertCanUseFinance(user);
    const close = await this.requireClose(periodId);
    const blockers = await this.closeBlockers(
      close.period.startsOn,
      close.period.endsOn,
    );
    if (
      Object.values(blockers).some(
        (value) => typeof value === 'number' && value > 0,
      )
    )
      throw new BadRequestException(
        'Resolve all open finance transactions before period close',
      );
    const [taskCount, openTasks, reconciliationRun, blockingExceptions] = await Promise.all([
      this.prisma.periodCloseTask.count({ where: { periodCloseId: close.id } }),
      this.prisma.periodCloseTask.count({ where: { periodCloseId: close.id, isRequired: true, status: 'PENDING' } }),
      this.prisma.closeReconciliationRun.findUnique({ where: { periodCloseId: close.id }, select: { id: true } }),
      this.prisma.reconciliationException.count({ where: { run: { periodCloseId: close.id }, status: 'OPEN', severity: 'BLOCKING' } }),
    ]);
    if (taskCount === 0 || !reconciliationRun) throw new BadRequestException('Initialize close controls and run reconciliations before submission');
    if (openTasks > 0) throw new BadRequestException('Complete every required close task before submission');
    if (blockingExceptions > 0) throw new BadRequestException('Resolve or Finance Head-waive every blocking reconciliation exception');
    const checks = close.checklist as Record<string, unknown>;
    const confirmations = [
      'bankReconciled',
      'gstReviewed',
      'tdsReviewed',
      'accrualsReviewed',
      'managementReviewReady',
    ];
    if (confirmations.some((k) => checks[k] !== true))
      throw new BadRequestException('Complete every period-close confirmation');
    return this.prisma.$transaction(async (tx) => {
      await tx.accountingPeriod.update({
        where: { id: periodId },
        data: { status: AccountingPeriodStatus.SOFT_CLOSED },
      });
      return tx.periodClose.update({
        where: { periodId },
        data: {
          status: PeriodCloseStatus.PENDING_APPROVAL,
          submittedAt: new Date(),
        },
        include: { period: true },
      });
    });
  }

  async approveClose(periodId: string, user: AuthenticatedUser) {
    await this.access.assertAccountsHead(user);
    const close = await this.requireClose(periodId);
    if (close.status !== PeriodCloseStatus.PENDING_APPROVAL)
      throw new BadRequestException('Period close is not pending approval');
    if (close.preparedById === user.id)
      throw new BadRequestException(
        'Finance Head cannot approve a close they prepared',
      );
    const blockingExceptions = await this.prisma.reconciliationException.count({ where: { run: { periodCloseId: close.id }, status: 'OPEN', severity: 'BLOCKING' } });
    if (blockingExceptions > 0) throw new BadRequestException('Period close has unresolved blocking reconciliation exceptions');
    return this.prisma.$transaction(async (tx) => {
      await tx.accountingPeriod.update({
        where: { id: periodId },
        data: { status: AccountingPeriodStatus.CLOSED },
      });
      return tx.periodClose.update({
        where: { periodId },
        data: {
          status: PeriodCloseStatus.COMPLETED,
          approvedById: user.id,
          approvedAt: new Date(),
        },
        include: { period: true },
      });
    });
  }

  async rejectClose(
    periodId: string,
    comment: string,
    user: AuthenticatedUser,
  ) {
    await this.access.assertAccountsHead(user);
    const close = await this.requireClose(periodId);
    if (close.status !== PeriodCloseStatus.PENDING_APPROVAL)
      throw new BadRequestException('Period close is not pending approval');
    return this.prisma.$transaction(async (tx) => {
      await tx.accountingPeriod.update({
        where: { id: periodId },
        data: { status: AccountingPeriodStatus.OPEN },
      });
      return tx.periodClose.update({
        where: { periodId },
        data: {
          status: PeriodCloseStatus.REJECTED,
          rejectionComment: comment,
        },
        include: { period: true },
      });
    });
  }

  async closeStatus(periodId: string, user: AuthenticatedUser) {
    await this.access.assertCanUseFinance(user);
    const period = await this.prisma.accountingPeriod.findUnique({
      where: { id: periodId },
    });
    if (!period) throw new NotFoundException('Accounting period not found');
    const close = await this.prisma.periodClose.findUnique({
      where: { periodId },
      include: { period: true },
    });
    return {
      close,
      blockers: await this.closeBlockers(period.startsOn, period.endsOn),
    };
  }

  private async postNote(note: any, approverId: string) {
    const increase = note.noteType === FinanceNoteType.DEBIT_NOTE;
    const isAr = note.side === FinanceNoteSide.ACCOUNTS_RECEIVABLE;
    const invoice = isAr ? note.salesInvoice : note.apInvoice;
    const rate = invoice.exchangeRateToInr;
    const total = note.totalAmount.times(rate).toDecimalPlaces(2);
    if (!increase && note.totalAmount.gt(invoice.outstandingAmount))
      throw new BadRequestException(
        'Credit note now exceeds invoice outstanding',
      );
    return this.prisma.$transaction(async (tx) => {
      const control = await this.account(tx, isAr ? '1100' : '2000');
      const base = await this.account(
        tx,
        isAr ? '4000' : note.apInvoice.purchaseOrderId ? '1200' : '6100',
      );
      const tax = await this.account(tx, isAr ? '2100' : '1300');
      const baseValue = note.taxableAmount.times(rate).toDecimalPlaces(2);
      const taxValue = note.cgstAmount
        .plus(note.sgstAmount)
        .plus(note.igstAmount)
        .times(rate)
        .toDecimalPlaces(2);
      const controlDebit = isAr === increase;
      const baseDebit = !controlDebit;
      const lines: any[] = [
        {
          sequence: 1,
          accountId: control.id,
          debit: controlDebit ? total : 0,
          credit: controlDebit ? 0 : total,
        },
        {
          sequence: 2,
          accountId: base.id,
          debit: baseDebit ? baseValue : 0,
          credit: baseDebit ? 0 : baseValue,
        },
      ];
      if (taxValue.gt(0))
        lines.push({
          sequence: 3,
          accountId: tax.id,
          debit: baseDebit ? taxValue : 0,
          credit: baseDebit ? 0 : taxValue,
        });
      const journal = await this.finance.postJournalTx(tx, {
        entryDate: note.noteDate,
        description: `${note.noteType.replace('_', ' ')} ${note.noteNumber}`,
        reference: invoice.invoiceNumber ?? invoice.internalBillNumber,
        createdById: note.createdById,
        submittedById: note.submittedById,
        submittedAt: note.submittedAt,
        approvedById: approverId,
        lines,
      });
      const delta = increase ? note.totalAmount : note.totalAmount.negated();
      const nextOutstanding = invoice.outstandingAmount.plus(delta);
      if (isAr)
        await tx.salesInvoice.update({
          where: { id: invoice.id },
          data: {
            outstandingAmount: nextOutstanding,
            ...(nextOutstanding.eq(0)
              ? { status: SalesInvoiceStatus.PAID }
              : {}),
          },
        });
      else
        await tx.accountsPayableInvoice.update({
          where: { id: invoice.id },
          data: {
            outstandingAmount: nextOutstanding,
            ...(nextOutstanding.eq(0) ? { status: ApInvoiceStatus.PAID } : {}),
          },
        });
      return tx.financeAdjustmentNote.update({
        where: { id: note.id },
        data: {
          status: FinanceNoteStatus.POSTED,
          approvedById: approverId,
          approvedAt: new Date(),
          journalEntryId: journal.id,
        },
        include: NOTE_INCLUDE,
      });
    });
  }

  private async closeBlockers(from: Date, to: Date) {
    const [
      journals,
      arInvoices,
      apInvoices,
      receipts,
      payments,
      notes,
      itcExceptions,
    ] = await Promise.all([
      this.prisma.journalEntry.count({
        where: {
          entryDate: { gte: from, lte: to },
          status: {
            in: [
              JournalStatus.DRAFT,
              JournalStatus.PENDING_APPROVAL,
              JournalStatus.REJECTED,
            ],
          },
        },
      }),
      this.prisma.salesInvoice.count({
        where: {
          invoiceDate: { gte: from, lte: to },
          status: {
            in: [
              SalesInvoiceStatus.DRAFT,
              SalesInvoiceStatus.PENDING_APPROVAL,
              SalesInvoiceStatus.REJECTED,
              SalesInvoiceStatus.GST_PENDING,
            ],
          },
        },
      }),
      this.prisma.accountsPayableInvoice.count({
        where: {
          invoiceDate: { gte: from, lte: to },
          status: {
            in: [
              ApInvoiceStatus.DRAFT,
              ApInvoiceStatus.PENDING_MATCH,
              ApInvoiceStatus.MATCH_EXCEPTION,
              ApInvoiceStatus.PENDING_APPROVAL,
              ApInvoiceStatus.REJECTED,
            ],
          },
        },
      }),
      this.prisma.customerReceipt.count({
        where: {
          receiptDate: { gte: from, lte: to },
          status: { in: ['DRAFT', 'PENDING_APPROVAL', 'REJECTED'] },
        },
      }),
      this.prisma.accountsPayablePayment.count({
        where: {
          plannedDate: { gte: from, lte: to },
          status: {
            in: [
              ApPaymentStatus.DRAFT,
              ApPaymentStatus.PENDING_APPROVAL,
              ApPaymentStatus.REJECTED,
            ],
          },
        },
      }),
      this.prisma.financeAdjustmentNote.count({
        where: {
          noteDate: { gte: from, lte: to },
          status: {
            in: [
              FinanceNoteStatus.DRAFT,
              FinanceNoteStatus.PENDING_APPROVAL,
              FinanceNoteStatus.REJECTED,
            ],
          },
        },
      }),
      this.prisma.accountsPayableInvoice.count({
        where: {
          invoiceDate: { gte: from, lte: to },
          itcStatus: {
            in: [GstItcStatus.PENDING_RECONCILIATION, GstItcStatus.MISMATCHED],
          },
          OR: [
            { inputCgstAmount: { gt: 0 } },
            { inputSgstAmount: { gt: 0 } },
            { inputIgstAmount: { gt: 0 } },
          ],
        },
      }),
    ]);
    return {
      openJournals: journals,
      openArInvoices: arInvoices,
      openApInvoices: apInvoices,
      openReceipts: receipts,
      openPayments: payments,
      openAdjustmentNotes: notes,
      itcExceptions,
      bankReconciled: false,
      gstReviewed: false,
      tdsReviewed: false,
      accrualsReviewed: false,
      managementReviewReady: false,
    };
  }

  private async resolveNoteInvoice(side: FinanceNoteSide, id: string) {
    const invoice =
      side === FinanceNoteSide.ACCOUNTS_RECEIVABLE
        ? await this.prisma.salesInvoice.findUnique({ where: { id } })
        : await this.prisma.accountsPayableInvoice.findUnique({
            where: { id },
          });
    if (!invoice) throw new NotFoundException('Referenced invoice not found');
    const valid =
      side === FinanceNoteSide.ACCOUNTS_RECEIVABLE
        ? [
            SalesInvoiceStatus.ISSUED,
            SalesInvoiceStatus.PARTIALLY_PAID,
            SalesInvoiceStatus.OVERDUE,
          ]
        : [
            ApInvoiceStatus.APPROVED,
            ApInvoiceStatus.PARTIALLY_PAID,
            ApInvoiceStatus.DISPUTED,
          ];
    if (!(valid as string[]).includes(invoice.status))
      throw new BadRequestException(
        'Referenced invoice is not open for adjustment',
      );
    return invoice;
  }
  private async requireNote(id: string) {
    const n = await this.prisma.financeAdjustmentNote.findUnique({
      where: { id },
      include: NOTE_INCLUDE,
    });
    if (!n) throw new NotFoundException('Adjustment note not found');
    return n;
  }
  private async requireTds(id: string) {
    const t = await this.prisma.tdsSection.findUnique({ where: { id } });
    if (!t) throw new NotFoundException('TDS section not found');
    return t;
  }
  private async requireClose(periodId: string) {
    const c = await this.prisma.periodClose.findUnique({
      where: { periodId },
      include: { period: true },
    });
    if (!c) throw new NotFoundException('Period close has not been prepared');
    return c;
  }
  private async account(tx: Prisma.TransactionClient, code: string) {
    const settings = await tx.financeProductionSettings.findUnique({ where: { id: 'INDIA' } });
    const mapped = (settings?.controlAccountMap as Record<string, string> | null)?.[code] || code;
    const a = await tx.ledgerAccount.findUnique({ where: { code: mapped } });
    if (!a)
      throw new BadRequestException(`Ledger account ${mapped} is not configured`);
    return a;
  }
  private async openPeriod(tx: Prisma.TransactionClient, date: Date) {
    const p = await tx.accountingPeriod.findFirst({
      where: { startsOn: { lte: date }, endsOn: { gte: date } },
    });
    if (!p || p.status !== AccountingPeriodStatus.OPEN)
      throw new BadRequestException('Accounting period is not open');
    return p;
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
  private day(value: string) {
    return new Date(`${value.slice(0, 10)}T00:00:00.000Z`);
  }
  private endDay(value: string) {
    return new Date(`${value.slice(0, 10)}T23:59:59.999Z`);
  }
}
