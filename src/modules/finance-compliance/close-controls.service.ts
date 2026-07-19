import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, ReconciliationSeverity } from '@prisma/client';
import { AuthenticatedUser } from '../../common/decorators/current-user.decorator';
import { PrismaService } from '../../core/database/prisma.service';
import { FinanceAccessService } from '../finance/finance-access.service';
import { ResolveExceptionDto, UpdateCloseTaskDto } from './dto/close-controls.dto';

const TASKS = [
  ['TRANSACTIONS', 'Complete transaction cut-off', 'CUT_OFF'],
  ['BANK', 'Complete bank reconciliation', 'BANK_RECONCILIATION'],
  ['RECEIVABLES', 'Review customer balances and credit notes', 'AR_REVIEW'],
  ['PAYABLES', 'Review vendor balances, GRNI and debit notes', 'AP_REVIEW'],
  ['TAX', 'Reconcile GST ledgers and returns', 'GST_REVIEW'],
  ['TAX', 'Reconcile TDS liability, challans and returns', 'TDS_REVIEW'],
  ['ACCOUNTING', 'Post accruals, prepayments and depreciation', 'ADJUSTMENTS'],
  ['CONTROL', 'Run and resolve close reconciliations', 'RECONCILIATIONS'],
  ['REPORTING', 'Review trial balance and management pack', 'MANAGEMENT_REVIEW'],
] as const;

@Injectable()
export class CloseControlsService {
  constructor(private readonly prisma: PrismaService, private readonly access: FinanceAccessService) {}

  async workspace(periodId: string, user: AuthenticatedUser) {
    await this.access.assertCanUseFinance(user); const close = await this.requireClose(periodId); await this.seedTasks(close.id);
    const [tasks, run] = await Promise.all([
      this.prisma.periodCloseTask.findMany({ where: { periodCloseId: close.id }, orderBy: { sequence: 'asc' } }),
      this.prisma.closeReconciliationRun.findUnique({ where: { periodCloseId: close.id }, include: { exceptions: { orderBy: [{ severity: 'desc' }, { createdAt: 'asc' }] } } }),
    ]);
    return { close, tasks, reconciliation: run };
  }

  async updateTask(periodId: string, taskId: string, dto: UpdateCloseTaskDto, user: AuthenticatedUser) {
    await this.access.assertCanUseFinance(user); const close = await this.requireClose(periodId);
    const task = await this.prisma.periodCloseTask.findFirst({ where: { id: taskId, periodCloseId: close.id } }); if (!task) throw new NotFoundException('Close task not found');
    if (close.status === 'COMPLETED') throw new BadRequestException('Completed close tasks are immutable');
    return this.prisma.periodCloseTask.update({ where: { id: taskId }, data: { status: dto.status, notes: dto.notes?.trim(), completedById: dto.status === 'PENDING' ? null : user.id, completedAt: dto.status === 'PENDING' ? null : new Date() } });
  }

  async run(periodId: string, user: AuthenticatedUser) {
    await this.access.assertCanUseFinance(user); const close = await this.requireClose(periodId); const p = close.period;
    const controls = await Promise.all([
      this.trialBalance(p.id), this.controlBalance('AR_CONTROL', '1100', await this.arOutstanding(p.endsOn), p.endsOn),
      this.controlBalance('AP_CONTROL', '2000', await this.apOutstanding(p.endsOn), p.endsOn),
      this.periodControl('GST_OUTPUT', '2100', await this.outputGst(p.startsOn, p.endsOn), p.startsOn, p.endsOn, 'credit'),
      this.periodControl('GST_INPUT', '1300', await this.inputGst(p.startsOn, p.endsOn), p.startsOn, p.endsOn, 'debit'),
      this.periodControl('TDS_PAYABLE', '2200', await this.tdsBooked(p.startsOn, p.endsOn), p.startsOn, p.endsOn, 'credit'),
      this.bankControl(p.startsOn, p.endsOn), this.complianceControl(p.startsOn.toISOString().slice(0, 7)),
    ]);
    const exceptions = controls.filter((x) => !x.ok).map((x) => ({ exceptionKey: x.key, controlType: x.key, title: x.title, severity: x.severity, ledgerAmount: x.ledger, sourceAmount: x.source, variance: x.variance, details: x.details as Prisma.InputJsonObject }));
    const summary = { controlCount: controls.length, passed: controls.filter((x) => x.ok).length, exceptions: exceptions.length, blocking: exceptions.filter((x) => x.severity === 'BLOCKING').length, generatedAt: new Date().toISOString() };
    return this.prisma.$transaction(async (tx) => {
      const run = await tx.closeReconciliationRun.upsert({ where: { periodCloseId: close.id }, create: { periodCloseId: close.id, status: exceptions.length ? 'EXCEPTIONS' : 'PASSED', summary, generatedById: user.id }, update: { status: exceptions.length ? 'EXCEPTIONS' : 'PASSED', summary, generatedById: user.id, generatedAt: new Date() } });
      const keys = exceptions.map((x) => x.exceptionKey); await tx.reconciliationException.deleteMany({ where: { runId: run.id, status: 'OPEN', exceptionKey: { notIn: keys } } });
      for (const x of exceptions) await tx.reconciliationException.upsert({ where: { runId_exceptionKey: { runId: run.id, exceptionKey: x.exceptionKey } }, create: { runId: run.id, ...x }, update: { ...x, status: 'OPEN', resolvedAt: null, resolvedById: null, resolutionNote: null } });
      return tx.closeReconciliationRun.findUnique({ where: { id: run.id }, include: { exceptions: true } });
    });
  }

  async resolve(id: string, dto: ResolveExceptionDto, user: AuthenticatedUser) {
    dto.status === 'WAIVED' ? await this.access.assertAccountsHead(user) : await this.access.assertCanUseFinance(user);
    const row = await this.prisma.reconciliationException.findUnique({ where: { id }, include: { run: { include: { periodClose: true } } } }); if (!row) throw new NotFoundException('Reconciliation exception not found');
    if (row.run.periodClose.status === 'COMPLETED') throw new BadRequestException('Completed-close exceptions are immutable');
    return this.prisma.reconciliationException.update({ where: { id }, data: { status: dto.status, resolutionNote: dto.resolutionNote.trim(), assignedToId: dto.assignedToId ?? row.assignedToId, resolvedById: user.id, resolvedAt: new Date() } });
  }

  private async seedTasks(closeId: string) { await this.prisma.periodCloseTask.createMany({ data: TASKS.map(([category, title, code], i) => ({ periodCloseId: closeId, category, title, taskCode: code, sequence: i + 1 })), skipDuplicates: true }); }
  private async requireClose(periodId: string) { const x = await this.prisma.periodClose.findUnique({ where: { periodId }, include: { period: true } }); if (!x) throw new NotFoundException('Prepare the period close before using close controls'); return x; }
  private d(x: Prisma.Decimal | null | undefined) { return new Prisma.Decimal(x ?? 0); }
  private result(key: string, title: string, ledger: Prisma.Decimal, source: Prisma.Decimal, severity: ReconciliationSeverity = 'BLOCKING') { const variance = ledger.minus(source).toDecimalPlaces(2); return { key, title, ledger, source, variance, severity, ok: variance.abs().lte(0.01), details: { tolerance: '0.01' } }; }
  private async trialBalance(periodId: string) { const x = await this.prisma.journalLine.aggregate({ where: { journal: { periodId, status: 'POSTED' } }, _sum: { debit: true, credit: true } }); return this.result('TRIAL_BALANCE', 'Posted journal debits equal credits', this.d(x._sum.debit), this.d(x._sum.credit)); }
  private async ledger(code: string, to: Date, from?: Date) { const settings = await this.prisma.financeProductionSettings.findUnique({ where: { id: 'INDIA' } }); const mapped = (settings?.controlAccountMap as Record<string, string> | null)?.[code] || code; return this.prisma.journalLine.aggregate({ where: { account: { code: mapped }, journal: { status: 'POSTED', entryDate: { ...(from ? { gte: from } : {}), lte: to } } }, _sum: { debit: true, credit: true } }); }
  private async controlBalance(key: string, code: string, source: Prisma.Decimal, to: Date) { const x = await this.ledger(code, to); return this.result(key, `${key.replace('_', ' ')} agrees to subledger`, this.d(x._sum.debit).minus(this.d(x._sum.credit)), source); }
  private async periodControl(key: string, code: string, source: Prisma.Decimal, from: Date, to: Date, normal: 'debit'|'credit') { const x = await this.ledger(code, to, from); const ledger = normal === 'debit' ? this.d(x._sum.debit).minus(this.d(x._sum.credit)) : this.d(x._sum.credit).minus(this.d(x._sum.debit)); return this.result(key, `${key.replace('_', ' ')} agrees to source register`, ledger, source); }
  private async arOutstanding(to: Date) { const x = await this.prisma.salesInvoice.aggregate({ where: { invoiceDate: { lte: to }, status: { in: ['ISSUED','PARTIALLY_PAID','OVERDUE'] } }, _sum: { outstandingAmount: true } }); return this.d(x._sum.outstandingAmount); }
  private async apOutstanding(to: Date) { const x = await this.prisma.accountsPayableInvoice.aggregate({ where: { invoiceDate: { lte: to }, status: { in: ['APPROVED','PARTIALLY_PAID','DISPUTED'] } }, _sum: { outstandingAmount: true } }); return this.d(x._sum.outstandingAmount); }
  private async outputGst(from: Date, to: Date) { const x = await this.prisma.salesInvoice.aggregate({ where: { invoiceDate: { gte: from, lte: to }, status: { in: ['ISSUED','PARTIALLY_PAID','PAID','OVERDUE'] } }, _sum: { cgstAmount: true, sgstAmount: true, igstAmount: true } }); return this.d(x._sum.cgstAmount).plus(this.d(x._sum.sgstAmount)).plus(this.d(x._sum.igstAmount)); }
  private async inputGst(from: Date, to: Date) { const x = await this.prisma.accountsPayableInvoice.aggregate({ where: { invoiceDate: { gte: from, lte: to }, status: { in: ['APPROVED','PARTIALLY_PAID','PAID','DISPUTED'] } }, _sum: { inputCgstAmount: true, inputSgstAmount: true, inputIgstAmount: true } }); return this.d(x._sum.inputCgstAmount).plus(this.d(x._sum.inputSgstAmount)).plus(this.d(x._sum.inputIgstAmount)); }
  private async tdsBooked(from: Date, to: Date) { const x = await this.prisma.accountsPayableInvoice.aggregate({ where: { invoiceDate: { gte: from, lte: to }, status: { in: ['APPROVED','PARTIALLY_PAID','PAID','DISPUTED'] } }, _sum: { tdsAmount: true } }); return this.d(x._sum.tdsAmount); }
  private async bankControl(from: Date, to: Date) { const count = await this.prisma.bankStatementLine.count({ where: { transactionDate: { gte: from, lte: to }, resolution: 'PENDING' } }); return { key: 'BANK_RECONCILIATION', title: 'Bank statement lines are resolved', ledger: new Prisma.Decimal(count), source: new Prisma.Decimal(0), variance: new Prisma.Decimal(count), severity: ReconciliationSeverity.BLOCKING, ok: count === 0, details: { pendingLines: count } }; }
  private async complianceControl(period: string) { const count = await this.prisma.complianceDueDate.count({ where: { taxPeriod: period, completedAt: null, dueDate: { lt: new Date() } } }); return { key: 'COMPLIANCE_OVERDUE', title: 'Period compliance obligations are completed', ledger: new Prisma.Decimal(count), source: new Prisma.Decimal(0), variance: new Prisma.Decimal(count), severity: ReconciliationSeverity.WARNING, ok: count === 0, details: { overdueObligations: count } }; }
}
