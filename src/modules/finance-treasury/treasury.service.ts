import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  AccountingPeriodStatus,
  FinanceAdvanceSide,
  JournalStatus,
  Prisma,
} from '@prisma/client';
import { AuthenticatedUser } from '../../common/decorators/current-user.decorator';
import { PrismaService } from '../../core/database/prisma.service';
import { FinanceAccessService } from '../finance/finance-access.service';
import {
  ApplyAdvanceDto,
  CreateFxRunDto,
  CreditControlDto,
  FxSettingsDto,
  ReverseFxDto,
} from './dto/treasury.dto';

@Injectable()
export class TreasuryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: FinanceAccessService,
  ) {}

  async dashboard(user: AuthenticatedUser) {
    await this.access.assertCanUseFinance(user);
    const [runs, controls, customerReceipts, vendorPayments, applications] =
      await this.prisma.$transaction([
        this.prisma.fxRevaluationRun.findMany({
          include: { lines: true },
          orderBy: { createdAt: 'desc' },
          take: 12,
        }),
        this.prisma.customerCreditControl.findMany({
          orderBy: { updatedAt: 'desc' },
        }),
        this.prisma.customerReceipt.findMany({
          where: { status: 'POSTED', unappliedAmount: { gt: 0 } },
          include: { customer: true },
          orderBy: { receiptDate: 'desc' },
        }),
        this.prisma.accountsPayablePayment.findMany({
          where: { status: 'EXECUTED' },
          include: { supplier: true, vendor: true, allocations: true },
          orderBy: { executedDate: 'desc' },
        }),
        this.prisma.financeAdvanceApplication.findMany({
          orderBy: { applicationDate: 'desc' },
          take: 50,
        }),
      ]);
    const usedBySource = new Map<string, Prisma.Decimal>();
    applications.forEach((x) =>
      usedBySource.set(
        `${x.side}:${x.sourceId}`,
        (
          usedBySource.get(`${x.side}:${x.sourceId}`) ?? new Prisma.Decimal(0)
        ).plus(x.amount),
      ),
    );
    const customerAdvances = customerReceipts
      .map((x) => ({
        side: 'CUSTOMER',
        sourceId: x.id,
        number: x.receiptNumber,
        party: x.customer.name,
        currencyCode: x.currencyCode,
        available: x.unappliedAmount
          .minus(usedBySource.get(`CUSTOMER:${x.id}`) ?? 0)
          .toString(),
      }))
      .filter((x) => Number(x.available) > 0);
    const vendorAdvances = vendorPayments
      .map((x) => {
        const allocated = x.allocations.reduce(
          (s, a) => s.plus(a.amount),
          new Prisma.Decimal(0),
        );
        const original = x.amount.minus(allocated);
        return {
          side: 'VENDOR',
          sourceId: x.id,
          number: x.paymentNumber,
          party: x.supplier?.companyName ?? x.vendor?.companyName,
          currencyCode: x.currencyCode,
          available: original
            .minus(usedBySource.get(`VENDOR:${x.id}`) ?? 0)
            .toString(),
        };
      })
      .filter((x) => Number(x.available) > 0);
    return {
      runs,
      controls,
      advances: [...customerAdvances, ...vendorAdvances],
      applications,
    };
  }

  async saveCreditControl(dto: CreditControlDto, user: AuthenticatedUser) {
    await this.access.assertAccountsHead(user);
    const customer = await this.prisma.customer.findUnique({
      where: { id: dto.customerId },
    });
    if (!customer) throw new NotFoundException('Customer not found');
    return this.prisma.customerCreditControl.upsert({
      where: { customerId: dto.customerId },
      create: {
        customerId: dto.customerId,
        creditLimitInr: dto.creditLimitInr,
        overdueGraceDays: dto.overdueGraceDays ?? 0,
        blockOnLimit: dto.blockOnLimit ?? true,
        blockOnOverdue: dto.blockOnOverdue ?? true,
        reviewDate: dto.reviewDate ? new Date(dto.reviewDate) : undefined,
        notes: dto.notes,
        createdById: user.id,
        updatedById: user.id,
      },
      update: {
        creditLimitInr: dto.creditLimitInr,
        overdueGraceDays: dto.overdueGraceDays ?? 0,
        blockOnLimit: dto.blockOnLimit ?? true,
        blockOnOverdue: dto.blockOnOverdue ?? true,
        reviewDate: dto.reviewDate ? new Date(dto.reviewDate) : null,
        notes: dto.notes,
        updatedById: user.id,
      },
    });
  }
  async saveFxSettings(dto: FxSettingsDto, user: AuthenticatedUser) {
    await this.access.assertAccountsHead(user);
    const count = await this.prisma.ledgerAccount.count({
      where: {
        id: { in: [dto.gainAccountId, dto.lossAccountId] },
        isActive: true,
      },
    });
    if (count !== 2 || dto.gainAccountId === dto.lossAccountId)
      throw new BadRequestException(
        'Select two distinct active FX gain/loss accounts',
      );
    return this.prisma.financeFxSettings.upsert({
      where: { id: 'INDIA' },
      create: { id: 'INDIA', ...dto, updatedById: user.id },
      update: { ...dto, updatedById: user.id },
    });
  }
  async creditExposure(customerId: string, user: AuthenticatedUser) {
    await this.access.assertCanUseFinance(user);
    const [control, invoices] = await Promise.all([
      this.prisma.customerCreditControl.findUnique({ where: { customerId } }),
      this.prisma.salesInvoice.findMany({
        where: {
          customerId,
          status: { in: ['ISSUED', 'PARTIALLY_PAID', 'OVERDUE'] },
        },
      }),
    ]);
    const outstanding = invoices.reduce(
      (s, x) => s.plus(x.outstandingAmount.times(x.exchangeRateToInr)),
      new Prisma.Decimal(0),
    );
    const overdue = invoices
      .filter((x) => x.dueDate < new Date())
      .reduce(
        (s, x) => s.plus(x.outstandingAmount.times(x.exchangeRateToInr)),
        new Prisma.Decimal(0),
      );
    return {
      control,
      outstandingInr: outstanding.toFixed(2),
      overdueInr: overdue.toFixed(2),
      availableCreditInr: control
        ? control.creditLimitInr.minus(outstanding).toFixed(2)
        : null,
    };
  }
  async overrideInvoice(id: string, reason: string, user: AuthenticatedUser) {
    await this.access.assertAccountsHead(user);
    if (!reason?.trim())
      throw new BadRequestException('Credit override reason is required');
    const invoice = await this.prisma.salesInvoice.findUnique({
      where: { id },
    });
    if (!invoice || !['DRAFT', 'REJECTED'].includes(invoice.status))
      throw new BadRequestException(
        'Only a draft or rejected invoice can receive a credit override',
      );
    return this.prisma.salesInvoice.update({
      where: { id },
      data: {
        creditOverrideReason: reason.trim(),
        creditOverrideApprovedById: user.id,
        creditOverrideApprovedAt: new Date(),
      },
    });
  }

  async createFxRun(dto: CreateFxRunDto, user: AuthenticatedUser) {
    await this.access.assertCanUseFinance(user);
    const period = await this.prisma.accountingPeriod.findUnique({
      where: { id: dto.periodId },
    });
    if (!period || period.status !== AccountingPeriodStatus.OPEN)
      throw new BadRequestException(
        'FX revaluation requires an open accounting period',
      );
    if (
      await this.prisma.fxRevaluationRun.findUnique({
        where: { periodId: dto.periodId },
      })
    )
      throw new BadRequestException(
        'This period already has an FX revaluation run',
      );
    const rates = Object.fromEntries(
      Object.entries(dto.closingRates).map(([k, v]) => [
        k.toUpperCase(),
        new Prisma.Decimal(v),
      ]),
    );
    if (Object.values(rates).some((x) => x.lte(0)))
      throw new BadRequestException('Closing FX rates must be positive');
    const [ar, ap] = await Promise.all([
      this.prisma.salesInvoice.findMany({
        where: {
          currencyCode: { not: 'INR' },
          invoiceDate: { lte: period.endsOn },
          outstandingAmount: { gt: 0 },
          status: { in: ['ISSUED', 'PARTIALLY_PAID', 'OVERDUE'] },
        },
        include: { customer: true },
      }),
      this.prisma.accountsPayableInvoice.findMany({
        where: {
          currencyCode: { not: 'INR' },
          invoiceDate: { lte: period.endsOn },
          outstandingAmount: { gt: 0 },
          status: { in: ['APPROVED', 'PARTIALLY_PAID', 'DISPUTED'] },
        },
        include: { supplier: true, vendor: true },
      }),
    ]);
    const lines: any[] = [];
    for (const x of ar)
      lines.push(
        this.fxLine(
          'AR',
          x.id,
          x.invoiceNumber,
          x.customer.name,
          x.currencyCode,
          x.outstandingAmount,
          x.exchangeRateToInr,
          rates[x.currencyCode],
          false,
        ),
      );
    for (const x of ap)
      lines.push(
        this.fxLine(
          'AP',
          x.id,
          x.internalBillNumber,
          x.supplier?.companyName ?? x.vendor?.companyName ?? x.partyId,
          x.currencyCode,
          x.outstandingAmount,
          x.exchangeRateToInr,
          rates[x.currencyCode],
          true,
        ),
      );
    const gain = lines.reduce(
        (s, x) => (x.gainLossInr.gt(0) ? s.plus(x.gainLossInr) : s),
        new Prisma.Decimal(0),
      ),
      loss = lines.reduce(
        (s, x) => (x.gainLossInr.lt(0) ? s.plus(x.gainLossInr.abs()) : s),
        new Prisma.Decimal(0),
      );
    const runNumber = `FX-${period.endsOn.getUTCFullYear()}-${String(period.periodNumber).padStart(2, '0')}`;
    return this.prisma.fxRevaluationRun.create({
      data: {
        runNumber,
        periodId: period.id,
        closingRates: dto.closingRates,
        totalGainInr: gain,
        totalLossInr: loss,
        gainAccountId: dto.gainAccountId,
        lossAccountId: dto.lossAccountId,
        createdById: user.id,
        lines: { create: lines },
      },
      include: { lines: true },
    });
  }
  async submitFx(id: string, user: AuthenticatedUser) {
    await this.access.assertCanUseFinance(user);
    const x = await this.requireFx(id);
    if (x.status !== 'DRAFT')
      throw new BadRequestException('Only draft FX runs can be submitted');
    return this.prisma.fxRevaluationRun.update({
      where: { id },
      data: {
        status: 'PENDING_APPROVAL',
        submittedById: user.id,
        submittedAt: new Date(),
      },
    });
  }
  async approveFx(id: string, user: AuthenticatedUser) {
    await this.access.assertAccountsHead(user);
    const run = await this.requireFx(id);
    if (run.status !== 'PENDING_APPROVAL')
      throw new BadRequestException('FX run is not pending approval');
    if (run.createdById === user.id)
      throw new BadRequestException(
        'Finance Head cannot approve an FX run they created',
      );
    return this.postFx(run, user.id);
  }
  async reverseFx(id: string, dto: ReverseFxDto, user: AuthenticatedUser) {
    await this.access.assertAccountsHead(user);
    const run = await this.requireFx(id);
    if (run.status !== 'POSTED' || !run.journalEntryId)
      throw new BadRequestException('Only a posted FX run can be reversed');
    const date = this.day(dto.reversalDate);
    return this.prisma.$transaction(async (tx) => {
      const original = await tx.journalEntry.findUnique({
        where: { id: run.journalEntryId! },
        include: { lines: true },
      });
      if (!original) throw new NotFoundException('FX journal not found');
      const period = await this.openPeriod(tx, date),
        number = await this.number(tx, 'JOURNAL', 'JV', date.getUTCFullYear());
      const j = await tx.journalEntry.create({
        data: {
          journalNumber: number,
          entryDate: date,
          periodId: period.id,
          description: `Reversal of ${run.runNumber}`,
          reference: run.runNumber,
          status: 'POSTED',
          createdById: user.id,
          approvedById: user.id,
          approvedAt: new Date(),
          reversalOfId: original.id,
          lines: {
            create: original.lines.map((l, i) => ({
              sequence: i + 1,
              accountId: l.accountId,
              debit: l.credit,
              credit: l.debit,
              description: 'FX revaluation reversal',
            })),
          },
        },
      });
      return tx.fxRevaluationRun.update({
        where: { id },
        data: {
          status: 'REVERSED',
          reversalEntryId: j.id,
          reversedAt: new Date(),
        },
      });
    });
  }

  async applyAdvance(dto: ApplyAdvanceDto, user: AuthenticatedUser) {
    await this.access.assertAccountsHead(user);
    return dto.side === 'CUSTOMER'
      ? this.applyCustomer(dto, user.id)
      : this.applyVendor(dto, user.id);
  }
  private async applyCustomer(d: ApplyAdvanceDto, actor: string) {
    const [r, i, used] = await Promise.all([
      this.prisma.customerReceipt.findUnique({ where: { id: d.sourceId } }),
      this.prisma.salesInvoice.findUnique({ where: { id: d.targetInvoiceId } }),
      this.usedAdvance('CUSTOMER', d.sourceId),
    ]);
    if (!r || r.status !== 'POSTED' || !i || r.customerId !== i.customerId)
      throw new BadRequestException(
        'Customer advance and invoice must be posted and belong to the same customer',
      );
    const amount = new Prisma.Decimal(d.amount);
    if (
      amount.gt(r.unappliedAmount.minus(used)) ||
      amount.gt(i.outstandingAmount)
    )
      throw new BadRequestException(
        'Application exceeds available advance or invoice outstanding',
      );
    return this.postAdvance(
      d,
      actor,
      r.currencyCode,
      r.exchangeRateToInr,
      '2300',
      '1100',
      i.id,
      r.id,
      i.outstandingAmount,
    );
  }
  private async applyVendor(d: ApplyAdvanceDto, actor: string) {
    const [p, i, used] = await Promise.all([
      this.prisma.accountsPayablePayment.findUnique({
        where: { id: d.sourceId },
        include: { allocations: true },
      }),
      this.prisma.accountsPayableInvoice.findUnique({
        where: { id: d.targetInvoiceId },
      }),
      this.usedAdvance('VENDOR', d.sourceId),
    ]);
    if (
      !p ||
      p.status !== 'EXECUTED' ||
      !i ||
      p.partyType !== i.partyType ||
      p.partyId !== i.partyId
    )
      throw new BadRequestException(
        'Vendor advance and invoice must be posted and belong to the same party',
      );
    const allocated = p.allocations.reduce(
        (s, x) => s.plus(x.amount),
        new Prisma.Decimal(0),
      ),
      amount = new Prisma.Decimal(d.amount);
    if (
      amount.gt(p.amount.minus(allocated).minus(used)) ||
      amount.gt(i.outstandingAmount)
    )
      throw new BadRequestException(
        'Application exceeds available advance or invoice outstanding',
      );
    return this.postAdvance(
      d,
      actor,
      p.currencyCode,
      p.exchangeRateToInr,
      '2000',
      '1500',
      i.id,
      p.id,
      i.outstandingAmount,
    );
  }
  private async postAdvance(
    d: ApplyAdvanceDto,
    actor: string,
    currency: string,
    rate: Prisma.Decimal,
    debitCode: string,
    creditCode: string,
    invoiceId: string,
    sourceId: string,
    invoiceOutstanding: Prisma.Decimal,
  ) {
    const date = this.day(d.applicationDate),
      amount = new Prisma.Decimal(d.amount),
      paid = amount.equals(invoiceOutstanding);
    return this.prisma.$transaction(async (tx) => {
      const period = await this.openPeriod(tx, date),
        debit = await this.account(tx, debitCode),
        credit = await this.account(tx, creditCode),
        number = await this.number(tx, 'JOURNAL', 'JV', date.getUTCFullYear()),
        appNo = await this.number(
          tx,
          'ADVANCE_APPLICATION',
          'ADV',
          date.getUTCFullYear(),
        ),
        value = amount.times(rate).toDecimalPlaces(2);
      const j = await tx.journalEntry.create({
        data: {
          journalNumber: number,
          entryDate: date,
          periodId: period.id,
          description: `${d.side} advance application ${appNo}`,
          reference: appNo,
          status: 'POSTED',
          createdById: actor,
          approvedById: actor,
          approvedAt: new Date(),
          lines: {
            create: [
              { sequence: 1, accountId: debit.id, debit: value, credit: 0 },
              { sequence: 2, accountId: credit.id, debit: 0, credit: value },
            ],
          },
        },
      });
      if (d.side === 'CUSTOMER')
        await tx.salesInvoice.update({
          where: { id: invoiceId },
          data: {
            paidAmount: { increment: amount },
            outstandingAmount: { decrement: amount },
            status: paid ? 'PAID' : 'PARTIALLY_PAID',
          },
        });
      else
        await tx.accountsPayableInvoice.update({
          where: { id: invoiceId },
          data: {
            paidAmount: { increment: amount },
            outstandingAmount: { decrement: amount },
            status: paid ? 'PAID' : 'PARTIALLY_PAID',
          },
        });
      return tx.financeAdvanceApplication.create({
        data: {
          applicationNumber: appNo,
          side: d.side as FinanceAdvanceSide,
          sourceId,
          targetInvoiceId: invoiceId,
          applicationDate: date,
          currencyCode: currency,
          amount,
          exchangeRateToInr: rate,
          journalEntryId: j.id,
          createdById: actor,
          approvedById: actor,
        },
      });
    });
  }
  private fxLine(
    side: string,
    id: string,
    no: string,
    party: string,
    currency: string,
    outstanding: Prisma.Decimal,
    original: Prisma.Decimal,
    closing: Prisma.Decimal | undefined,
    isAp: boolean,
  ) {
    if (!closing)
      throw new BadRequestException(`Closing rate is required for ${currency}`);
    const carrying = outstanding.times(original).toDecimalPlaces(2),
      revalued = outstanding.times(closing).toDecimalPlaces(2),
      delta = isAp ? carrying.minus(revalued) : revalued.minus(carrying);
    return {
      side,
      documentId: id,
      documentNumber: no,
      partyName: party,
      currencyCode: currency,
      foreignOutstanding: outstanding,
      originalRate: original,
      closingRate: closing,
      carryingAmountInr: carrying,
      revaluedAmountInr: revalued,
      gainLossInr: delta,
    };
  }
  private async postFx(run: any, actor: string) {
    return this.prisma.$transaction(async (tx) => {
      const period = await tx.accountingPeriod.findUnique({
        where: { id: run.periodId },
      });
      if (!period || period.status !== 'OPEN')
        throw new BadRequestException('FX period is not open');
      const ar = await this.account(tx, '1100'),
        ap = await this.account(tx, '2000'),
        gain = await tx.ledgerAccount.findUnique({
          where: { id: run.gainAccountId },
        }),
        loss = await tx.ledgerAccount.findUnique({
          where: { id: run.lossAccountId },
        });
      if (!gain || !loss)
        throw new BadRequestException('FX gain/loss accounts are invalid');
      const lines: any[] = [];
      for (const x of run.lines) {
        const v = x.gainLossInr.abs();
        if (v.lte(0)) continue;
        const control = x.side === 'AR' ? ar : ap;
        if (x.gainLossInr.gt(0)) {
          lines.push(
            {
              sequence: lines.length + 1,
              accountId: control.id,
              debit: v,
              credit: 0,
            },
            {
              sequence: lines.length + 2,
              accountId: gain.id,
              debit: 0,
              credit: v,
            },
          );
        } else {
          lines.push(
            {
              sequence: lines.length + 1,
              accountId: loss.id,
              debit: v,
              credit: 0,
            },
            {
              sequence: lines.length + 2,
              accountId: control.id,
              debit: 0,
              credit: v,
            },
          );
        }
      }
      if (!lines.length)
        throw new BadRequestException(
          'FX run has no revaluation variance to post',
        );
      const number = await this.number(
          tx,
          'JOURNAL',
          'JV',
          period.endsOn.getUTCFullYear(),
        ),
        j = await tx.journalEntry.create({
          data: {
            journalNumber: number,
            entryDate: period.endsOn,
            periodId: period.id,
            description: `FX revaluation ${run.runNumber}`,
            reference: run.runNumber,
            status: 'POSTED',
            createdById: run.createdById,
            submittedById: run.submittedById,
            submittedAt: run.submittedAt,
            approvedById: actor,
            approvedAt: new Date(),
            lines: { create: lines },
          },
        });
      return tx.fxRevaluationRun.update({
        where: { id: run.id },
        data: {
          status: 'POSTED',
          approvedById: actor,
          approvedAt: new Date(),
          journalEntryId: j.id,
        },
        include: { lines: true },
      });
    });
  }
  private async requireFx(id: string) {
    const x = await this.prisma.fxRevaluationRun.findUnique({
      where: { id },
      include: { lines: true },
    });
    if (!x) throw new NotFoundException('FX revaluation run not found');
    return x;
  }
  private async usedAdvance(side: string, id: string) {
    const x = await this.prisma.financeAdvanceApplication.aggregate({
      where: { side: side as FinanceAdvanceSide, sourceId: id },
      _sum: { amount: true },
    });
    return new Prisma.Decimal(x._sum.amount ?? 0);
  }
  private day(x: string) {
    return new Date(`${x.slice(0, 10)}T00:00:00.000Z`);
  }
  private async account(tx: Prisma.TransactionClient, code: string) {
    const settings = await tx.financeProductionSettings.findUnique({ where: { id: 'INDIA' } });
    const mapped = (settings?.controlAccountMap as Record<string, string> | null)?.[code] || code;
    const x = await tx.ledgerAccount.findUnique({ where: { code: mapped } });
    if (!x)
      throw new BadRequestException(`Ledger account ${mapped} is not configured`);
    return x;
  }
  private async openPeriod(tx: Prisma.TransactionClient, date: Date) {
    const x = await tx.accountingPeriod.findFirst({
      where: { startsOn: { lte: date }, endsOn: { gte: date } },
    });
    if (!x || x.status !== 'OPEN')
      throw new BadRequestException('Accounting period is not open');
    return x;
  }
  private async number(
    tx: Prisma.TransactionClient,
    entity: string,
    prefix: string,
    year: number,
  ) {
    const x = await tx.financeSequence.upsert({
      where: { entity_year: { entity, year } },
      create: { entity, year, lastValue: 1 },
      update: { lastValue: { increment: 1 } },
    });
    return `${prefix}-${year}-${String(x.lastValue).padStart(5, '0')}`;
  }
}
