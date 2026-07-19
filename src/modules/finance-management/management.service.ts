import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  AccountType,
  AccountingPeriodStatus,
  FinanceBudgetStatus,
  FinanceScheduleStatus,
  FixedAssetStatus,
  JournalStatus,
  Prisma,
  SalesInvoiceStatus,
} from '@prisma/client';
import { AuthenticatedUser } from '../../common/decorators/current-user.decorator';
import { PrismaService } from '../../core/database/prisma.service';
import { FinanceAccessService } from '../finance/finance-access.service';
import {
  CreateBudgetDto,
  CreateFixedAssetDto,
  CreateScheduleDto,
  ManagementRangeDto,
} from './dto/management.dto';
const BUDGET_INCLUDE = {
  fiscalYear: {
    include: { periods: { orderBy: { periodNumber: 'asc' as const } } },
  },
  lines: {
    include: { period: true, account: true, costCenter: true },
    orderBy: [
      { period: { periodNumber: 'asc' as const } },
      { account: { code: 'asc' as const } },
    ],
  },
};
const ASSET_INCLUDE = {
  assetAccount: true,
  accumulatedDepreciationAccount: true,
  depreciationExpenseAccount: true,
  acquisitionCreditAccount: true,
  depreciationEntries: {
    include: { period: true },
    orderBy: { period: { startsOn: 'asc' as const } },
  },
};
const SCHEDULE_INCLUDE = {
  debitAccount: true,
  creditAccount: true,
  costCenter: true,
  executions: {
    include: { journalEntry: true },
    orderBy: { runDate: 'desc' as const },
  },
};
@Injectable()
export class ManagementService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: FinanceAccessService,
  ) {}
  async createBudget(d: CreateBudgetDto, u: AuthenticatedUser) {
    await this.access.assertCanUseFinance(u);
    const fy = await this.prisma.fiscalYear.findUnique({
      where: { id: d.fiscalYearId },
      include: { periods: true },
    });
    if (!fy) throw new NotFoundException('Fiscal year not found');
    const ids = new Set(fy.periods.map((p) => p.id));
    if (d.lines.some((l) => !ids.has(l.periodId)))
      throw new BadRequestException(
        'Every budget line must belong to the selected fiscal year',
      );
    const duplicate = new Set<string>();
    for (const l of d.lines) {
      const key = [
        l.periodId,
        l.accountId,
        l.costCenterId ?? '',
        l.projectReference ?? '',
      ].join('|');
      if (duplicate.has(key))
        throw new BadRequestException(
          'Duplicate budget line dimensions are not allowed',
        );
      duplicate.add(key);
    }
    return this.prisma.financeBudget.create({
      data: {
        name: d.name.trim(),
        fiscalYearId: d.fiscalYearId,
        notes: d.notes,
        createdById: u.id,
        lines: { create: d.lines },
      },
      include: BUDGET_INCLUDE,
    });
  }
  async budgets(u: AuthenticatedUser) {
    await this.access.assertCanUseFinance(u);
    return this.prisma.financeBudget.findMany({
      include: BUDGET_INCLUDE,
      orderBy: { createdAt: 'desc' },
    });
  }
  async submitBudget(id: string, u: AuthenticatedUser) {
    await this.access.assertCanUseFinance(u);
    const b = await this.budget(id);
    if (
      ![FinanceBudgetStatus.DRAFT, FinanceBudgetStatus.REJECTED].includes(
        b.status as any,
      )
    )
      throw new BadRequestException(
        'Only draft or rejected budgets can be submitted',
      );
    return this.prisma.financeBudget.update({
      where: { id },
      data: {
        status: FinanceBudgetStatus.PENDING_APPROVAL,
        submittedById: u.id,
        submittedAt: new Date(),
        rejectionComment: null,
      },
      include: BUDGET_INCLUDE,
    });
  }
  async approveBudget(id: string, u: AuthenticatedUser) {
    await this.access.assertAccountsHead(u);
    const b = await this.budget(id);
    if (b.status !== FinanceBudgetStatus.PENDING_APPROVAL)
      throw new BadRequestException('Budget is not pending approval');
    if (b.createdById === u.id)
      throw new BadRequestException(
        'Finance Head cannot approve a budget they created',
      );
    return this.prisma.financeBudget.update({
      where: { id },
      data: {
        status: FinanceBudgetStatus.APPROVED,
        approvedById: u.id,
        approvedAt: new Date(),
      },
      include: BUDGET_INCLUDE,
    });
  }
  async rejectBudget(id: string, c: string, u: AuthenticatedUser) {
    await this.access.assertAccountsHead(u);
    const b = await this.budget(id);
    if (b.status !== FinanceBudgetStatus.PENDING_APPROVAL)
      throw new BadRequestException('Budget is not pending approval');
    return this.prisma.financeBudget.update({
      where: { id },
      data: { status: FinanceBudgetStatus.REJECTED, rejectionComment: c },
      include: BUDGET_INCLUDE,
    });
  }
  async budgetVsActual(id: string, u: AuthenticatedUser) {
    await this.access.assertCanUseFinance(u);
    const b = await this.budget(id);
    if (
      ![FinanceBudgetStatus.APPROVED, FinanceBudgetStatus.LOCKED].includes(
        b.status as any,
      )
    )
      throw new BadRequestException('Budget must be approved');
    const actual = await this.prisma.journalLine.findMany({
      where: {
        journal: {
          status: JournalStatus.POSTED,
          period: { fiscalYearId: b.fiscalYearId },
        },
      },
      include: { journal: true, account: true },
    });
    return b.lines.map((l) => {
      const rows = actual.filter(
        (a) =>
          a.journal.periodId === l.periodId &&
          a.accountId === l.accountId &&
          (l.costCenterId ? a.costCenterId === l.costCenterId : true) &&
          (l.projectReference
            ? a.projectReference === l.projectReference
            : true),
      );
      const value = rows.reduce(
        (s, r) =>
          s.plus(this.actualValue(r.account.accountType, r.debit, r.credit)),
        new Prisma.Decimal(0),
      );
      return {
        period: l.period.name,
        accountCode: l.account.code,
        accountName: l.account.name,
        costCenter: l.costCenter?.name,
        projectReference: l.projectReference,
        budget: l.amount.toString(),
        actual: value.toString(),
        variance: l.amount.minus(value).toString(),
        variancePercent: l.amount.eq(0)
          ? null
          : l.amount
              .minus(value)
              .div(l.amount)
              .times(100)
              .toDecimalPlaces(2)
              .toString(),
      };
    });
  }
  async createAsset(d: CreateFixedAssetDto, u: AuthenticatedUser) {
    await this.access.assertCanUseFinance(u);
    if ((d.residualValue ?? 0) >= d.originalCost)
      throw new BadRequestException(
        'Residual value must be below original cost',
      );
    await this.assertAssetAccounts(d);
    const date = this.day(d.capitalizationDate);
    return this.prisma.$transaction(async (tx) => {
      const assetNumber = await this.number(
        tx,
        'FIXED_ASSET',
        'FA',
        date.getUTCFullYear(),
      );
      return tx.fixedAsset.create({
        data: {
          assetNumber,
          name: d.name,
          description: d.description,
          purchaseDate: this.day(d.purchaseDate),
          capitalizationDate: date,
          originalCost: d.originalCost,
          residualValue: d.residualValue ?? 0,
          usefulLifeMonths: d.usefulLifeMonths,
          location: d.location,
          serialNumber: d.serialNumber,
          vendorReference: d.vendorReference,
          assetAccountId: d.assetAccountId,
          accumulatedDepreciationAccountId: d.accumulatedDepreciationAccountId,
          depreciationExpenseAccountId: d.depreciationExpenseAccountId,
          acquisitionCreditAccountId: d.acquisitionCreditAccountId,
          createdById: u.id,
        },
        include: ASSET_INCLUDE,
      });
    });
  }
  async assets(u: AuthenticatedUser) {
    await this.access.assertCanUseFinance(u);
    return this.prisma.fixedAsset.findMany({
      include: ASSET_INCLUDE,
      orderBy: { capitalizationDate: 'desc' },
    });
  }
  async submitAsset(id: string, u: AuthenticatedUser) {
    await this.access.assertCanUseFinance(u);
    const a = await this.asset(id);
    if (
      ![FixedAssetStatus.DRAFT, FixedAssetStatus.REJECTED].includes(
        a.status as any,
      )
    )
      throw new BadRequestException(
        'Only draft or rejected assets can be submitted',
      );
    return this.prisma.fixedAsset.update({
      where: { id },
      data: {
        status: FixedAssetStatus.PENDING_APPROVAL,
        rejectionComment: null,
      },
    });
  }
  async approveAsset(id: string, u: AuthenticatedUser) {
    await this.access.assertAccountsHead(u);
    const a = await this.asset(id);
    if (a.status !== FixedAssetStatus.PENDING_APPROVAL)
      throw new BadRequestException('Asset is not pending approval');
    if (a.createdById === u.id)
      throw new BadRequestException(
        'Finance Head cannot approve an asset they created',
      );
    return this.prisma.$transaction(async (tx) => {
      const p = await this.period(tx, a.capitalizationDate),
        jn = await this.number(
          tx,
          'JOURNAL',
          'JV',
          a.capitalizationDate.getUTCFullYear(),
        );
      await tx.journalEntry.create({
        data: {
          journalNumber: jn,
          entryDate: a.capitalizationDate,
          periodId: p.id,
          description: `Capitalisation ${a.assetNumber} ${a.name}`,
          reference: a.vendorReference,
          status: JournalStatus.POSTED,
          createdById: a.createdById,
          submittedById: a.createdById,
          submittedAt: new Date(),
          approvedById: u.id,
          approvedAt: new Date(),
          lines: {
            create: [
              {
                sequence: 1,
                accountId: a.assetAccountId,
                debit: a.originalCost,
                credit: 0,
              },
              {
                sequence: 2,
                accountId: a.acquisitionCreditAccountId,
                debit: 0,
                credit: a.originalCost,
              },
            ],
          },
        },
      });
      return tx.fixedAsset.update({
        where: { id },
        data: {
          status: FixedAssetStatus.ACTIVE,
          approvedById: u.id,
          approvedAt: new Date(),
        },
        include: ASSET_INCLUDE,
      });
    });
  }
  async rejectAsset(id: string, c: string, u: AuthenticatedUser) {
    await this.access.assertAccountsHead(u);
    const a = await this.asset(id);
    if (a.status !== FixedAssetStatus.PENDING_APPROVAL)
      throw new BadRequestException('Asset is not pending approval');
    return this.prisma.fixedAsset.update({
      where: { id },
      data: { status: FixedAssetStatus.REJECTED, rejectionComment: c },
    });
  }
  async runDepreciation(asOf: string, u: AuthenticatedUser) {
    await this.access.assertAccountsHead(u);
    const date = this.day(asOf),
      period = await this.prisma.accountingPeriod.findFirst({
        where: { startsOn: { lte: date }, endsOn: { gte: date } },
      });
    if (!period || period.status !== AccountingPeriodStatus.OPEN)
      throw new BadRequestException('Depreciation period is not open');
    const assets = await this.prisma.fixedAsset.findMany({
        where: {
          status: FixedAssetStatus.ACTIVE,
          capitalizationDate: { lte: period.endsOn },
        },
        include: { depreciationEntries: true },
      }),
      created = [] as any[];
    for (const a of assets) {
      if (a.depreciationEntries.some((e) => e.periodId === period.id)) continue;
      const depreciable = a.originalCost.minus(a.residualValue),
        monthly = depreciable.div(a.usefulLifeMonths).toDecimalPlaces(2),
        remaining = depreciable.minus(a.accumulatedDepreciation),
        amount = Prisma.Decimal.min(monthly, remaining);
      if (amount.lte(0)) continue;
      created.push(
        await this.prisma.$transaction(async (tx) => {
          const jn = await this.number(
            tx,
            'JOURNAL',
            'JV',
            date.getUTCFullYear(),
          );
          const j = await tx.journalEntry.create({
            data: {
              journalNumber: jn,
              entryDate: date,
              periodId: period.id,
              description: `Depreciation ${a.assetNumber} ${period.name}`,
              reference: a.assetNumber,
              status: JournalStatus.POSTED,
              createdById: a.createdById,
              submittedById: u.id,
              submittedAt: new Date(),
              approvedById: u.id,
              approvedAt: new Date(),
              lines: {
                create: [
                  {
                    sequence: 1,
                    accountId: a.depreciationExpenseAccountId,
                    debit: amount,
                    credit: 0,
                  },
                  {
                    sequence: 2,
                    accountId: a.accumulatedDepreciationAccountId,
                    debit: 0,
                    credit: amount,
                  },
                ],
              },
            },
          });
          await tx.fixedAsset.update({
            where: { id: a.id },
            data: {
              accumulatedDepreciation: { increment: amount },
              lastDepreciatedThrough: period.endsOn,
            },
          });
          return tx.assetDepreciationEntry.create({
            data: {
              assetId: a.id,
              periodId: period.id,
              amount,
              journalEntryId: j.id,
            },
          });
        }),
      );
    }
    return {
      period: period.name,
      entriesCreated: created.length,
      total: created
        .reduce((s, e) => s.plus(e.amount), new Prisma.Decimal(0))
        .toString(),
    };
  }
  async createSchedule(d: CreateScheduleDto, u: AuthenticatedUser) {
    await this.access.assertCanUseFinance(u);
    if (d.debitAccountId === d.creditAccountId)
      throw new BadRequestException('Debit and credit accounts must differ');
    await this.assertAccounts([d.debitAccountId, d.creditAccountId]);
    const start = this.day(d.startDate),
      end = d.endDate ? this.day(d.endDate) : undefined;
    if (end && end < start)
      throw new BadRequestException(
        'Schedule end date cannot precede start date',
      );
    return this.prisma.$transaction(async (tx) => {
      const n = await this.number(
        tx,
        'FINANCE_SCHEDULE',
        'SCH',
        start.getUTCFullYear(),
      );
      return tx.financeSchedule.create({
        data: {
          scheduleNumber: n,
          name: d.name,
          description: d.description,
          scheduleType: d.scheduleType,
          debitAccountId: d.debitAccountId,
          creditAccountId: d.creditAccountId,
          amountPerRun: d.amountPerRun,
          startDate: start,
          nextRunDate: start,
          endDate: end,
          remainingRuns: d.remainingRuns,
          costCenterId: d.costCenterId,
          projectReference: d.projectReference,
          createdById: u.id,
        },
        include: SCHEDULE_INCLUDE,
      });
    });
  }
  async schedules(u: AuthenticatedUser) {
    await this.access.assertCanUseFinance(u);
    return this.prisma.financeSchedule.findMany({
      include: SCHEDULE_INCLUDE,
      orderBy: { createdAt: 'desc' },
    });
  }
  async submitSchedule(id: string, u: AuthenticatedUser) {
    await this.access.assertCanUseFinance(u);
    const s = await this.schedule(id);
    if (
      ![FinanceScheduleStatus.DRAFT, FinanceScheduleStatus.REJECTED].includes(
        s.status as any,
      )
    )
      throw new BadRequestException(
        'Only draft or rejected schedules can be submitted',
      );
    return this.prisma.financeSchedule.update({
      where: { id },
      data: {
        status: FinanceScheduleStatus.PENDING_APPROVAL,
        rejectionComment: null,
      },
    });
  }
  async approveSchedule(id: string, u: AuthenticatedUser) {
    await this.access.assertAccountsHead(u);
    const s = await this.schedule(id);
    if (s.status !== FinanceScheduleStatus.PENDING_APPROVAL)
      throw new BadRequestException('Schedule is not pending approval');
    if (s.createdById === u.id)
      throw new BadRequestException(
        'Finance Head cannot approve a schedule they created',
      );
    return this.prisma.financeSchedule.update({
      where: { id },
      data: {
        status: FinanceScheduleStatus.ACTIVE,
        approvedById: u.id,
        approvedAt: new Date(),
      },
      include: SCHEDULE_INCLUDE,
    });
  }
  async rejectSchedule(id: string, c: string, u: AuthenticatedUser) {
    await this.access.assertAccountsHead(u);
    const s = await this.schedule(id);
    if (s.status !== FinanceScheduleStatus.PENDING_APPROVAL)
      throw new BadRequestException('Schedule is not pending approval');
    return this.prisma.financeSchedule.update({
      where: { id },
      data: { status: FinanceScheduleStatus.REJECTED, rejectionComment: c },
    });
  }
  async runSchedules(asOf: string, u: AuthenticatedUser) {
    await this.access.assertAccountsHead(u);
    const date = this.day(asOf),
      due = await this.prisma.financeSchedule.findMany({
        where: {
          status: FinanceScheduleStatus.ACTIVE,
          nextRunDate: { lte: date },
        },
      }),
      plans = due.map((schedule) => ({
        schedule,
        dates: this.dueDates(schedule, date),
      })),
      results = [] as any[];
    for (const plan of plans) {
      for (const run of plan.dates) {
        const period = await this.prisma.accountingPeriod.findFirst({
          where: { startsOn: { lte: run }, endsOn: { gte: run } },
        });
        if (!period || period.status !== AccountingPeriodStatus.OPEN)
          throw new BadRequestException(
            `Schedule ${plan.schedule.scheduleNumber} requires an open period for ${run.toISOString().slice(0, 10)}`,
          );
      }
    }
    for (const { schedule: s, dates } of plans) {
      for (const run of dates) {
        const execution = await this.prisma.$transaction(async (tx) => {
          const p = await this.period(tx, run),
            jn = await this.number(tx, 'JOURNAL', 'JV', run.getUTCFullYear());
          const j = await tx.journalEntry.create({
            data: {
              journalNumber: jn,
              entryDate: run,
              periodId: p.id,
              description: `${s.scheduleType.replaceAll('_', ' ')} ${s.name}`,
              reference: s.scheduleNumber,
              status: JournalStatus.POSTED,
              createdById: s.createdById,
              submittedById: u.id,
              submittedAt: new Date(),
              approvedById: u.id,
              approvedAt: new Date(),
              lines: {
                create: [
                  {
                    sequence: 1,
                    accountId: s.debitAccountId,
                    debit: s.amountPerRun,
                    credit: 0,
                    costCenterId: s.costCenterId,
                    projectReference: s.projectReference,
                  },
                  {
                    sequence: 2,
                    accountId: s.creditAccountId,
                    debit: 0,
                    credit: s.amountPerRun,
                    costCenterId: s.costCenterId,
                    projectReference: s.projectReference,
                  },
                ],
              },
            },
          });
          return tx.financeScheduleExecution.create({
            data: {
              scheduleId: s.id,
              runDate: run,
              periodId: p.id,
              amount: s.amountPerRun,
              journalEntryId: j.id,
            },
          });
        });
        results.push(execution);
      }
      const run = dates.length
          ? this.addMonth(dates[dates.length - 1])
          : s.nextRunDate,
        used = dates.length,
        nextRemaining = s.remainingRuns == null ? null : s.remainingRuns - used,
        complete = (s.endDate && run > s.endDate) || nextRemaining === 0;
      await this.prisma.financeSchedule.update({
        where: { id: s.id },
        data: {
          nextRunDate: run,
          remainingRuns: nextRemaining,
          status: complete
            ? FinanceScheduleStatus.COMPLETED
            : FinanceScheduleStatus.ACTIVE,
        },
      });
    }
    return {
      executionsCreated: results.length,
      total: results
        .reduce((sum, e) => sum.plus(e.amount), new Prisma.Decimal(0))
        .toString(),
    };
  }
  async inventoryValuation(asOf: string, u: AuthenticatedUser) {
    await this.access.assertCanUseFinance(u);
    const date = this.endDay(asOf),
      [movements, receipts] = await Promise.all([
        this.prisma.stockAdjustment.findMany({
          where: { bucket: 'ON_HAND', createdAt: { lte: date } },
          include: { item: true, storeLocation: true },
        }),
        this.prisma.goodsReceiptNoteLine.findMany({
          where: {
            acceptedQuantity: { gt: 0 },
            grn: { inspectedAt: { lte: date } },
          },
          include: { purchaseOrderLine: true },
        }),
      ]);
    const costs = new Map<
      string,
      { qty: Prisma.Decimal; value: Prisma.Decimal }
    >();
    for (const r of receipts) {
      const x = costs.get(r.itemId) ?? {
          qty: new Prisma.Decimal(0),
          value: new Prisma.Decimal(0),
        },
        q = r.acceptedQuantity ?? new Prisma.Decimal(0);
      x.qty = x.qty.plus(q);
      x.value = x.value.plus(q.times(r.purchaseOrderLine.unitPrice));
      costs.set(r.itemId, x);
    }
    const quantities = new Map<
      string,
      {
        item: (typeof movements)[number]['item'];
        location: (typeof movements)[number]['storeLocation'];
        quantity: Prisma.Decimal;
      }
    >();
    for (const movement of movements) {
      const key = `${movement.itemId}:${movement.storeLocationId}`,
        current = quantities.get(key) ?? {
          item: movement.item,
          location: movement.storeLocation,
          quantity: new Prisma.Decimal(0),
        };
      current.quantity = current.quantity.plus(movement.quantityChange);
      quantities.set(key, current);
    }
    return [...quantities.values()].map((b) => {
      const c = costs.get(b.item.id),
        avg =
          c && c.qty.gt(0)
            ? c.value.div(c.qty).toDecimalPlaces(4)
            : new Prisma.Decimal(0),
        value = b.quantity.times(avg).toDecimalPlaces(2);
      return {
        itemCode: b.item.itemCode,
        itemName: b.item.name,
        location: b.location.name,
        onHandQuantity: b.quantity.toString(),
        weightedAverageCost: avg.toString(),
        estimatedValue: value.toString(),
        costBasis: c ? 'QC-accepted GRN / PO price' : 'NO COST HISTORY',
      };
    });
  }
  async projectProfitability(r: ManagementRangeDto, u: AuthenticatedUser) {
    await this.access.assertCanUseFinance(u);
    const from = this.day(r.from),
      to = this.endDay(r.to),
      projects = await this.prisma.projectKickoff.findMany({
        include: {
          order: { include: { customer: true, salesInvoices: true } },
          materialIndents: { include: { issueNotes: true } },
        },
      }),
      issues = await this.prisma.goodsReceiptNoteLine.findMany({
        where: {
          acceptedQuantity: { gt: 0 },
          grn: { inspectedAt: { lte: to } },
        },
        include: { purchaseOrderLine: true },
      }),
      costs = new Map<string, { q: Prisma.Decimal; v: Prisma.Decimal }>();
    for (const x of issues) {
      const q = x.acceptedQuantity ?? new Prisma.Decimal(0),
        c = costs.get(x.itemId) ?? {
          q: new Prisma.Decimal(0),
          v: new Prisma.Decimal(0),
        };
      c.q = c.q.plus(q);
      c.v = c.v.plus(q.times(x.purchaseOrderLine.unitPrice));
      costs.set(x.itemId, c);
    }
    const journals = await this.prisma.journalLine.findMany({
      where: {
        journal: {
          status: JournalStatus.POSTED,
          entryDate: { gte: from, lte: to },
        },
        account: {
          accountType: {
            in: [
              AccountType.EXPENSE,
              AccountType.COST_OF_GOODS_SOLD,
              AccountType.OTHER_EXPENSE,
            ],
          },
        },
      },
      include: { journal: true },
    });
    return projects.map((p) => {
      const revenue = p.order.salesInvoices
          .filter(
            (i) =>
              i.invoiceDate >= from &&
              i.invoiceDate <= to &&
              ![
                SalesInvoiceStatus.DRAFT,
                SalesInvoiceStatus.REJECTED,
                SalesInvoiceStatus.CANCELLED,
              ].includes(i.status as any),
          )
          .reduce(
            (s, i) => s.plus(i.taxableAmount.times(i.exchangeRateToInr)),
            new Prisma.Decimal(0),
          ),
        refs = new Set([p.id, p.projectName, p.order.orderNumber]),
        ledgerCost = journals
          .filter((j) => j.projectReference && refs.has(j.projectReference))
          .reduce(
            (s, j) => s.plus(j.debit).minus(j.credit),
            new Prisma.Decimal(0),
          ),
        materialCost = p.materialIndents
          .flatMap((i) =>
            i.issueNotes.map((n) => {
              const c = costs.get(n.itemId);
              return c && c.q.gt(0)
                ? n.issuedQuantity.times(c.v.div(c.q))
                : new Prisma.Decimal(0);
            }),
          )
          .reduce((s, v) => s.plus(v), new Prisma.Decimal(0)),
        total = ledgerCost.plus(materialCost),
        profit = revenue.minus(total);
      return {
        projectId: p.id,
        projectName: p.projectName,
        orderNumber: p.order.orderNumber,
        customer: p.order.customer.name,
        revenue: revenue.toDecimalPlaces(2).toString(),
        ledgerCost: ledgerCost.toDecimalPlaces(2).toString(),
        estimatedMaterialCost: materialCost.toDecimalPlaces(2).toString(),
        totalCost: total.toDecimalPlaces(2).toString(),
        grossProfit: profit.toDecimalPlaces(2).toString(),
        marginPercent: revenue.eq(0)
          ? null
          : profit.div(revenue).times(100).toDecimalPlaces(2).toString(),
      };
    });
  }
  private actualValue(t: AccountType, d: Prisma.Decimal, c: Prisma.Decimal) {
    return t === AccountType.REVENUE || t === AccountType.OTHER_INCOME
      ? c.minus(d)
      : d.minus(c);
  }
  private async budget(id: string) {
    const b = await this.prisma.financeBudget.findUnique({
      where: { id },
      include: BUDGET_INCLUDE,
    });
    if (!b) throw new NotFoundException('Budget not found');
    return b;
  }
  private async asset(id: string) {
    const a = await this.prisma.fixedAsset.findUnique({
      where: { id },
      include: ASSET_INCLUDE,
    });
    if (!a) throw new NotFoundException('Asset not found');
    return a;
  }
  private async schedule(id: string) {
    const s = await this.prisma.financeSchedule.findUnique({
      where: { id },
      include: SCHEDULE_INCLUDE,
    });
    if (!s) throw new NotFoundException('Schedule not found');
    return s;
  }
  private async assertAccounts(ids: string[]) {
    const n = await this.prisma.ledgerAccount.count({
      where: { id: { in: [...new Set(ids)] }, isActive: true },
    });
    if (n !== new Set(ids).size)
      throw new BadRequestException(
        'Every selected ledger account must be active',
      );
  }
  private async assertAssetAccounts(d: CreateFixedAssetDto) {
    if (
      d.assetAccountId === d.acquisitionCreditAccountId ||
      d.depreciationExpenseAccountId === d.accumulatedDepreciationAccountId
    )
      throw new BadRequestException(
        'Fixed-asset debit and credit accounts must differ',
      );
    const accounts = await this.prisma.ledgerAccount.findMany({
      where: {
        id: {
          in: [
            d.assetAccountId,
            d.accumulatedDepreciationAccountId,
            d.depreciationExpenseAccountId,
            d.acquisitionCreditAccountId,
          ],
        },
        isActive: true,
      },
    });
    if (accounts.length !== 4)
      throw new BadRequestException(
        'Every fixed-asset ledger account must be active and distinct',
      );
    const byId = new Map(accounts.map((a) => [a.id, a]));
    if (
      byId.get(d.assetAccountId)?.accountType !== AccountType.ASSET ||
      byId.get(d.accumulatedDepreciationAccountId)?.accountType !==
        AccountType.ASSET
    )
      throw new BadRequestException(
        'Asset cost and accumulated depreciation require asset accounts',
      );
    if (
      ![AccountType.EXPENSE, AccountType.OTHER_EXPENSE].includes(
        byId.get(d.depreciationExpenseAccountId)?.accountType as any,
      )
    )
      throw new BadRequestException(
        'Depreciation requires an expense ledger account',
      );
  }
  private async period(tx: Prisma.TransactionClient, d: Date) {
    const p = await tx.accountingPeriod.findFirst({
      where: { startsOn: { lte: d }, endsOn: { gte: d } },
    });
    if (!p || p.status !== AccountingPeriodStatus.OPEN)
      throw new BadRequestException('Accounting period is not open');
    return p;
  }
  private async number(
    tx: Prisma.TransactionClient,
    e: string,
    p: string,
    y: number,
  ) {
    const s = await tx.financeSequence.upsert({
      where: { entity_year: { entity: e, year: y } },
      create: { entity: e, year: y, lastValue: 1 },
      update: { lastValue: { increment: 1 } },
    });
    return `${p}-${y}-${String(s.lastValue).padStart(5, '0')}`;
  }
  private day(v: string) {
    return new Date(`${v.slice(0, 10)}T00:00:00.000Z`);
  }
  private endDay(v: string) {
    return new Date(`${v.slice(0, 10)}T23:59:59.999Z`);
  }
  private addMonth(d: Date) {
    return new Date(
      Date.UTC(
        d.getUTCFullYear(),
        d.getUTCMonth() + 1,
        Math.min(d.getUTCDate(), 28),
      ),
    );
  }
  private dueDates(
    schedule: {
      nextRunDate: Date;
      endDate: Date | null;
      remainingRuns: number | null;
    },
    asOf: Date,
  ) {
    const dates: Date[] = [];
    let run = schedule.nextRunDate;
    while (
      run <= asOf &&
      (!schedule.endDate || run <= schedule.endDate) &&
      (schedule.remainingRuns == null || dates.length < schedule.remainingRuns)
    ) {
      dates.push(run);
      run = this.addMonth(run);
    }
    return dates;
  }
}
