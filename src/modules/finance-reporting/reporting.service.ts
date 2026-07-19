import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AccountType, CashFlowCategory, Prisma, Role } from '@prisma/client';
import { AuthenticatedUser } from '../../common/decorators/current-user.decorator';
import { PrismaService } from '../../core/database/prisma.service';
import { FinanceAccessService } from '../finance/finance-access.service';
import {
  AuditorGrantDto,
  CreatePackDto,
  CreateRolloverDto,
  ReportingRangeDto,
} from './dto/reporting.dto';
@Injectable()
export class ReportingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: FinanceAccessService,
  ) {}
  async dashboard(q: ReportingRangeDto, u: AuthenticatedUser) {
    await this.access.assertCanViewFinance(u);
    const [pnl, bs, cash, ar, ap, overdue] = await Promise.all([
      this.pnl(q),
      this.balanceSheet(q.to),
      this.cashFlow(q, u),
      this.prisma.salesInvoice.aggregate({
        where: { status: { in: ['ISSUED', 'PARTIALLY_PAID', 'OVERDUE'] } },
        _sum: { outstandingAmount: true },
      }),
      this.prisma.accountsPayableInvoice.aggregate({
        where: { status: { in: ['APPROVED', 'PARTIALLY_PAID', 'DISPUTED'] } },
        _sum: { outstandingAmount: true },
      }),
      this.prisma.salesInvoice.aggregate({
        where: {
          dueDate: { lt: new Date() },
          status: { in: ['ISSUED', 'PARTIALLY_PAID', 'OVERDUE'] },
        },
        _sum: { outstandingAmount: true },
      }),
    ]);
    const revenue = new Prisma.Decimal(pnl.revenue),
      receivables = new Prisma.Decimal(ar._sum.outstandingAmount ?? 0);
    return {
      period: q,
      kpis: {
        revenue: pnl.revenue,
        profitBeforeTax: pnl.profitBeforeTax,
        cashClosing: cash.closingCash,
        receivables: receivables.toFixed(2),
        payables: new Prisma.Decimal(ap._sum.outstandingAmount ?? 0).toFixed(2),
        overdueReceivables: new Prisma.Decimal(
          overdue._sum.outstandingAmount ?? 0,
        ).toFixed(2),
        dso: revenue.gt(0)
          ? receivables
              .div(revenue)
              .mul(this.days(q))
              .toDecimalPlaces(1)
              .toString()
          : '0',
      },
      pnl,
      balanceSheet: bs,
      cashFlow: cash,
    };
  }
  async cashFlow(q: ReportingRangeDto, u: AuthenticatedUser) {
    await this.access.assertCanViewFinance(u);
    const from = this.day(q.from),
      to = this.end(q.to),
      settings = await this.prisma.financeProductionSettings.findUnique({ where: { id: 'INDIA' } }),
      bankCode = (settings?.controlAccountMap as Record<string, string> | null)?.['1000'] || '1000',
      journals = await this.prisma.journalEntry.findMany({
        where: { status: 'POSTED', entryDate: { gte: from, lte: to } },
        include: { lines: { include: { account: true } } },
      });
    const totals = {
      OPERATING: new Prisma.Decimal(0),
      INVESTING: new Prisma.Decimal(0),
      FINANCING: new Prisma.Decimal(0),
      UNCLASSIFIED: new Prisma.Decimal(0),
    };
    for (const j of journals) {
      const bank = j.lines
        .filter((x) => x.account.code === bankCode)
        .reduce(
          (s, x) => s.plus(x.debit).minus(x.credit),
          new Prisma.Decimal(0),
        );
      if (bank.isZero()) continue;
      const cats = [
        ...new Set(
          j.lines
            .filter(
              (x) =>
                x.account.code !== bankCode &&
                x.account.cashFlowCategory &&
                x.account.cashFlowCategory !== 'NON_CASH',
            )
            .map((x) => x.account.cashFlowCategory as string),
        ),
      ];
      const cat = cats.length === 1 ? cats[0] : 'UNCLASSIFIED';
      totals[cat as keyof typeof totals] =
        totals[cat as keyof typeof totals].plus(bank);
    }
    const opening = await this.cashBalance(
      new Date('2000-01-01'),
      new Date(from.getTime() - 1),
    );
    const net = Object.values(totals).reduce(
      (s, x) => s.plus(x),
      new Prisma.Decimal(0),
    );
    return {
      from: q.from,
      to: q.to,
      openingCash: opening.toFixed(2),
      operating: totals.OPERATING.toFixed(2),
      investing: totals.INVESTING.toFixed(2),
      financing: totals.FINANCING.toFixed(2),
      unclassified: totals.UNCLASSIFIED.toFixed(2),
      netChange: net.toFixed(2),
      closingCash: opening.plus(net).toFixed(2),
    };
  }
  async balanceSheetReport(asOf: string, u: AuthenticatedUser) {
    await this.access.assertCanViewFinance(u);
    return this.balanceSheet(asOf);
  }
  async setCashFlowCategory(
    id: string,
    category: CashFlowCategory,
    u: AuthenticatedUser,
  ) {
    await this.access.assertAccountsHead(u);
    const a = await this.prisma.ledgerAccount.findUnique({ where: { id } });
    if (!a) throw new NotFoundException('Ledger account not found');
    return this.prisma.ledgerAccount.update({
      where: { id },
      data: { cashFlowCategory: category },
    });
  }
  async packs(u: AuthenticatedUser) {
    await this.access.assertCanViewFinance(u);
    return this.prisma.managementReportPack.findMany({
      orderBy: { periodTo: 'desc' },
    });
  }
  async createPack(d: CreatePackDto, u: AuthenticatedUser) {
    await this.access.assertCanUseFinance(u);
    const snapshot = await this.dashboard(d, u),
      year = new Date(d.to).getUTCFullYear(),
      seq = await this.prisma.financeSequence.upsert({
        where: { entity_year: { entity: 'MANAGEMENT_PACK', year } },
        create: { entity: 'MANAGEMENT_PACK', year, lastValue: 1 },
        update: { lastValue: { increment: 1 } },
      });
    return this.prisma.managementReportPack.create({
      data: {
        packNumber: `MRP-${year}-${String(seq.lastValue).padStart(4, '0')}`,
        title: d.title,
        periodFrom: this.day(d.from),
        periodTo: this.end(d.to),
        snapshot: JSON.parse(JSON.stringify(snapshot)),
        createdById: u.id,
      },
    });
  }
  async submitPack(id: string, u: AuthenticatedUser) {
    await this.access.assertCanUseFinance(u);
    const x = await this.requirePack(id);
    if (x.status !== 'DRAFT')
      throw new BadRequestException('Only draft packs can be submitted');
    return this.prisma.managementReportPack.update({
      where: { id },
      data: {
        status: 'PENDING_APPROVAL',
        submittedById: u.id,
        submittedAt: new Date(),
      },
    });
  }
  async approvePack(id: string, u: AuthenticatedUser) {
    await this.access.assertAccountsHead(u);
    const x = await this.requirePack(id);
    if (x.status !== 'PENDING_APPROVAL')
      throw new BadRequestException('Pack is not pending approval');
    if (x.createdById === u.id)
      throw new BadRequestException(
        'Finance Head cannot approve a pack they created',
      );
    return this.prisma.managementReportPack.update({
      where: { id },
      data: { status: 'APPROVED', approvedById: u.id, approvedAt: new Date() },
    });
  }
  async publishPack(id: string, u: AuthenticatedUser) {
    await this.access.assertAccountsHead(u);
    const x = await this.requirePack(id);
    if (x.status !== 'APPROVED')
      throw new BadRequestException('Only an approved pack can be published');
    return this.prisma.managementReportPack.update({
      where: { id },
      data: { status: 'PUBLISHED', publishedAt: new Date() },
    });
  }
  async grantAuditor(d: AuditorGrantDto, u: AuthenticatedUser) {
    if (u.role !== Role.SUPER_ADMIN)
      throw new ForbiddenException('Only Super Admin can grant auditor access');
    const e = await this.prisma.employee.findUnique({
      where: { id: d.employeeId },
    });
    if (!e || e.status !== 'ACTIVE')
      throw new BadRequestException('Auditor must be an active employee');
    return this.prisma.financeAuditorGrant.upsert({
      where: { employeeId: d.employeeId },
      create: {
        employeeId: d.employeeId,
        expiresAt: d.expiresAt ? new Date(d.expiresAt) : undefined,
        grantedById: u.id,
      },
      update: {
        expiresAt: d.expiresAt ? new Date(d.expiresAt) : null,
        isActive: true,
        grantedById: u.id,
        grantedAt: new Date(),
        revokedAt: null,
        revokedById: null,
      },
    });
  }
  async auditors(u: AuthenticatedUser) {
    if (u.role !== Role.SUPER_ADMIN)
      throw new ForbiddenException('Only Super Admin can view auditor grants');
    const grants = await this.prisma.financeAuditorGrant.findMany({
      orderBy: { grantedAt: 'desc' },
    });
    const employees = await this.prisma.employee.findMany({
      where: { id: { in: grants.map((x) => x.employeeId) } },
      select: { id: true, employeeId: true, firstName: true, lastName: true, email: true, status: true },
    });
    const byId = new Map(employees.map((x) => [x.id, x]));
    return grants.map((x) => ({ ...x, employee: byId.get(x.employeeId) ?? null }));
  }
  async revokeAuditor(employeeId: string, u: AuthenticatedUser) {
    if (u.role !== Role.SUPER_ADMIN)
      throw new ForbiddenException(
        'Only Super Admin can revoke auditor access',
      );
    return this.prisma.financeAuditorGrant.update({
      where: { employeeId },
      data: { isActive: false, revokedById: u.id, revokedAt: new Date() },
    });
  }
  async rollovers(u: AuthenticatedUser) {
    await this.access.assertCanViewFinance(u);
    return this.prisma.yearEndRollover.findMany({
      include: { openingBalances: true },
      orderBy: { createdAt: 'desc' },
    });
  }
  async createRollover(d: CreateRolloverDto, u: AuthenticatedUser) {
    await this.access.assertCanUseFinance(u);
    const [source, target, retained] = await Promise.all([
      this.prisma.fiscalYear.findUnique({
        where: { id: d.sourceFiscalYearId },
        include: { periods: true },
      }),
      this.prisma.fiscalYear.findUnique({
        where: { id: d.targetFiscalYearId },
      }),
      this.prisma.ledgerAccount.findUnique({
        where: { id: d.retainedEarningsAccountId },
      }),
    ]);
    if (!source || !target || !retained)
      throw new NotFoundException(
        'Fiscal year or retained earnings account not found',
      );
    if (
      source.periods.length !== 12 ||
      source.periods.some((x) => x.status !== 'CLOSED')
    )
      throw new BadRequestException('All 12 source periods must be closed');
    if (target.startsOn <= source.endsOn)
      throw new BadRequestException(
        'Target fiscal year must follow the source year',
      );
    const trial = await this.trial(
        '2000-01-01',
        source.endsOn.toISOString().slice(0, 10),
      ),
      pnl = await this.pnl({
        from: source.startsOn.toISOString().slice(0, 10),
        to: source.endsOn.toISOString().slice(0, 10),
      }),
      profit = new Prisma.Decimal(pnl.profitBeforeTax);
    const balances = trial
      .filter((x) => ['ASSET', 'LIABILITY', 'EQUITY'].includes(x.accountType))
      .map((x) => ({
        accountId: x.accountId,
        balance: new Prisma.Decimal(x.balance),
      }));
    const existing = balances.find((x) => x.accountId === retained.id);
    if (existing) existing.balance = existing.balance.minus(profit);
    else balances.push({ accountId: retained.id, balance: profit.negated() });
    const snapshot = {
      source: source.name,
      target: target.name,
      profitBeforeTax: profit.toString(),
      balances: balances.map((x) => ({
        accountId: x.accountId,
        balance: x.balance.toString(),
      })),
    };
    return this.prisma.yearEndRollover.create({
      data: {
        sourceFiscalYearId: source.id,
        targetFiscalYearId: target.id,
        retainedEarningsAccountId: retained.id,
        snapshot,
        createdById: u.id,
      },
    });
  }
  async submitRollover(id: string, u: AuthenticatedUser) {
    await this.access.assertCanUseFinance(u);
    const x = await this.requireRollover(id);
    if (x.status !== 'DRAFT')
      throw new BadRequestException('Only draft rollover can be submitted');
    return this.prisma.yearEndRollover.update({
      where: { id },
      data: {
        status: 'PENDING_APPROVAL',
        submittedById: u.id,
        submittedAt: new Date(),
      },
    });
  }
  async approveRollover(id: string, u: AuthenticatedUser) {
    await this.access.assertAccountsHead(u);
    const x = await this.requireRollover(id);
    if (x.status !== 'PENDING_APPROVAL')
      throw new BadRequestException('Rollover is not pending approval');
    if (x.createdById === u.id)
      throw new BadRequestException(
        'Finance Head cannot approve a rollover they created',
      );
    const snap = x.snapshot as any;
    return this.prisma.$transaction(async (tx) => {
      await tx.accountOpeningBalance.createMany({
        data: snap.balances.map((b: any) => {
          const v = new Prisma.Decimal(b.balance);
          return {
            rolloverId: x.id,
            fiscalYearId: x.targetFiscalYearId,
            accountId: b.accountId,
            debit: v.gt(0) ? v : 0,
            credit: v.lt(0) ? v.abs() : 0,
          };
        }),
      });
      await tx.fiscalYear.update({
        where: { id: x.sourceFiscalYearId },
        data: { status: 'CLOSED' },
      });
      return tx.yearEndRollover.update({
        where: { id },
        data: {
          status: 'COMPLETED',
          approvedById: u.id,
          approvedAt: new Date(),
        },
        include: { openingBalances: true },
      });
    });
  }
  private async trial(from: string, to: string) {
    const lines = await this.prisma.journalLine.findMany({
        where: {
          journal: {
            status: 'POSTED',
            entryDate: { gte: this.day(from), lte: this.end(to) },
          },
        },
        include: { account: true },
      }),
      map = new Map<string, any>();
    for (const l of lines) {
      const x = map.get(l.accountId) ?? {
        accountId: l.accountId,
        code: l.account.code,
        name: l.account.name,
        accountType: l.account.accountType,
        debit: new Prisma.Decimal(0),
        credit: new Prisma.Decimal(0),
      };
      x.debit = x.debit.plus(l.debit);
      x.credit = x.credit.plus(l.credit);
      map.set(l.accountId, x);
    }
    return [...map.values()].map((x) => ({
      ...x,
      debit: x.debit.toString(),
      credit: x.credit.toString(),
      balance: x.debit.minus(x.credit).toString(),
    }));
  }
  private async pnl(q: ReportingRangeDto) {
    const t = await this.trial(q.from, q.to),
      sum = (types: string[], credit: boolean) =>
        t
          .filter((x) => types.includes(x.accountType))
          .reduce(
            (s, x) =>
              s.plus(
                credit
                  ? new Prisma.Decimal(x.credit).minus(x.debit)
                  : new Prisma.Decimal(x.debit).minus(x.credit),
              ),
            new Prisma.Decimal(0),
          ),
      revenue = sum(['REVENUE'], true),
      cogs = sum(['COST_OF_GOODS_SOLD'], false),
      expenses = sum(['EXPENSE'], false),
      otherIncome = sum(['OTHER_INCOME'], true),
      otherExpenses = sum(['OTHER_EXPENSE'], false);
    return {
      revenue: revenue.toFixed(2),
      costOfGoodsSold: cogs.toFixed(2),
      grossProfit: revenue.minus(cogs).toFixed(2),
      operatingExpenses: expenses.toFixed(2),
      otherIncome: otherIncome.toFixed(2),
      otherExpenses: otherExpenses.toFixed(2),
      profitBeforeTax: revenue
        .minus(cogs)
        .minus(expenses)
        .plus(otherIncome)
        .minus(otherExpenses)
        .toFixed(2),
    };
  }
  private async balanceSheet(asOf: string) {
    const trial = await this.trial('2000-01-01', asOf);
    const rows = trial.filter((x) =>
      ['ASSET', 'LIABILITY', 'EQUITY'].includes(x.accountType),
    );
    const total = (type: string) =>
      rows
        .filter((x) => x.accountType === type)
        .reduce(
          (s, x) =>
            s.plus(
              type === 'ASSET'
                ? x.balance
                : new Prisma.Decimal(x.balance).negated(),
            ),
          new Prisma.Decimal(0),
        );
    const earnings = trial.reduce((sum, x) => {
      if (['REVENUE', 'OTHER_INCOME'].includes(x.accountType)) return sum.plus(new Prisma.Decimal(x.credit).minus(x.debit));
      if (['COST_OF_GOODS_SOLD', 'EXPENSE', 'OTHER_EXPENSE'].includes(x.accountType)) return sum.minus(new Prisma.Decimal(x.debit).minus(x.credit));
      return sum;
    }, new Prisma.Decimal(0));
    const equity = total('EQUITY').plus(earnings);
    return {
      asOf,
      assets: total('ASSET').toFixed(2),
      liabilities: total('LIABILITY').toFixed(2),
      equity: equity.toFixed(2),
      currentAndPriorEarnings: earnings.toFixed(2),
      difference: total('ASSET')
        .minus(total('LIABILITY'))
        .minus(equity)
        .toFixed(2),
      accounts: rows,
    };
  }
  private async cashBalance(from: Date, to: Date) {
    const settings = await this.prisma.financeProductionSettings.findUnique({ where: { id: 'INDIA' } });
    const code = (settings?.controlAccountMap as Record<string, string> | null)?.['1000'] || '1000';
    const x = await this.prisma.journalLine.aggregate({
      where: {
        account: { code },
        journal: { status: 'POSTED', entryDate: { gte: from, lte: to } },
      },
      _sum: { debit: true, credit: true },
    });
    return new Prisma.Decimal(x._sum.debit ?? 0).minus(x._sum.credit ?? 0);
  }
  private days(q: ReportingRangeDto) {
    return Math.max(
      1,
      Math.floor(
        (this.day(q.to).getTime() - this.day(q.from).getTime()) / 86400000,
      ) + 1,
    );
  }
  private day(x: string) {
    return new Date(`${x.slice(0, 10)}T00:00:00.000Z`);
  }
  private end(x: string) {
    return new Date(`${x.slice(0, 10)}T23:59:59.999Z`);
  }
  private async requirePack(id: string) {
    const x = await this.prisma.managementReportPack.findUnique({
      where: { id },
    });
    if (!x) throw new NotFoundException('Management pack not found');
    return x;
  }
  private async requireRollover(id: string) {
    const x = await this.prisma.yearEndRollover.findUnique({ where: { id } });
    if (!x) throw new NotFoundException('Rollover not found');
    return x;
  }
}
