import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  EmployeeStatus,
  PayrollRun,
  PayrollRunStatus,
  Payslip,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../../core/database/prisma.service';
import { endOfMonth } from '../../common/utils/date.util';
import { CreatePayrollRunDto } from './dto/create-payroll-run.dto';
import { PayrollRunEntity } from './entities/payroll-run.entity';
import { PayslipEntity } from './entities/payslip.entity';
import { PayrollComputationService } from './payroll-computation.service';
import { AuthenticatedUser } from '../../common/decorators/current-user.decorator';
import { FinanceAccessService } from '../finance/finance-access.service';
import { FinanceService } from '../finance/finance.service';

@Injectable()
export class PayrollRunsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly computation: PayrollComputationService,
    private readonly financeAccess: FinanceAccessService,
    private readonly finance: FinanceService,
  ) {}

  async create(
    dto: CreatePayrollRunDto,
    initiatedById: string,
  ): Promise<PayrollRunEntity> {
    const existing = await this.prisma.payrollRun.findUnique({
      where: { month_year: { month: dto.month, year: dto.year } },
    });
    if (existing) {
      throw new ConflictException(
        `A payroll run for ${dto.month}/${dto.year} already exists`,
      );
    }

    const created = await this.prisma.payrollRun.create({
      data: { month: dto.month, year: dto.year, initiatedById },
    });
    return this.toEntity(created);
  }

  /** Every run, most recently created first — small table, no pagination yet. */
  async findAll(): Promise<PayrollRunEntity[]> {
    const runs = await this.prisma.payrollRun.findMany({
      orderBy: [{ year: 'desc' }, { month: 'desc' }],
    });
    return runs.map((r) => this.toEntity(r));
  }

  async findOne(id: string): Promise<PayrollRunEntity> {
    const run = await this.findRawOrThrow(id);
    return this.toEntity(run);
  }

  /** Every payslip generated for one run — populated once status is COMPLETED. */
  async findPayslips(id: string): Promise<PayslipEntity[]> {
    await this.findRawOrThrow(id);
    const payslips = await this.prisma.payslip.findMany({
      where: { payrollRunId: id },
      orderBy: { createdAt: 'asc' },
    });
    return payslips.map((p) => this.toPayslipEntity(p));
  }

  /**
   * DRAFT -> PROCESSING -> COMPLETED. Loads every required StatutoryConfig
   * row up front (see PayrollComputationService.loadRequiredConfigs) —
   * missing config is a hard failure before any employee is touched, not
   * a per-employee silent zero. All payslips are written in a single
   * transaction so a mid-run failure rolls the whole run back to DRAFT
   * rather than leaving a half-populated COMPLETED run.
   */
  async processRun(id: string): Promise<PayrollRunEntity> {
    const run = await this.findRawOrThrow(id);
    if (run.status !== PayrollRunStatus.DRAFT) {
      throw new BadRequestException(
        `Only a DRAFT run can be processed (current status: ${run.status})`,
      );
    }

    const periodEnd = endOfMonth(
      new Date(Date.UTC(run.year, run.month - 1, 1)),
    );
    const periodStart = new Date(Date.UTC(run.year, run.month - 1, 1));
    const incompleteAttendance = await this.prisma.attendance.count({
      where: {
        date: { gte: periodStart, lte: periodEnd },
        OR: [
          { checkInTime: { not: null }, checkOutTime: null },
          { checkInTime: null, checkOutTime: { not: null } },
        ],
      },
    });
    if (incompleteAttendance > 0) {
      throw new BadRequestException(
        `Payroll cannot be processed while ${incompleteAttendance} attendance record(s) have a missing check-in or check-out`,
      );
    }
    const employees = await this.prisma.employee.findMany({
      where: { status: EmployeeStatus.ACTIVE },
    });

    const configs = await this.computation.loadRequiredConfigs(
      periodEnd,
      employees,
    );

    await this.prisma.payrollRun.update({
      where: { id },
      data: { status: PayrollRunStatus.PROCESSING },
    });

    try {
      const updated = await this.prisma.$transaction(async (tx) => {
        for (const employee of employees) {
          const result = await this.computation.computeForEmployee(
            employee,
            run,
            configs,
          );
          await tx.payslip.create({
            data: {
              payrollRunId: run.id,
              employeeId: result.employeeId,
              grossEarnings: result.grossEarnings,
              basicPaid: result.basicPaid,
              hraPaid: result.hraPaid,
              specialAllowancePaid: result.specialAllowancePaid,
              otherAllowancesPaid: result.otherAllowancesPaid,
              pfEmployee: result.pfEmployee,
              pfEmployer: result.pfEmployer,
              esiEmployee: result.esiEmployee,
              esiEmployer: result.esiEmployer,
              professionalTax: result.professionalTax,
              tdsDeducted: result.tdsDeducted,
              unpaidLeaveDeduction: result.unpaidLeaveDeduction,
              netPay: result.netPay,
              statutoryConfigSnapshot:
                result.statutoryConfigSnapshot as Prisma.InputJsonValue,
            },
          });
        }
        return tx.payrollRun.update({
          where: { id },
          data: {
            status: PayrollRunStatus.COMPLETED,
            processedAt: new Date(),
          },
        });
      });
      return this.toEntity(updated);
    } catch (err) {
      // Roll the run's status back to DRAFT so a failed process can be
      // retried after fixing whatever caused the failure (e.g. a missing
      // SalaryStructure for one employee) — the transaction above already
      // rolled back any partial Payslip writes.
      await this.prisma.payrollRun.update({
        where: { id },
        data: { status: PayrollRunStatus.DRAFT },
      });
      throw err;
    }
  }

  async lock(id: string): Promise<PayrollRunEntity> {
    const run = await this.findRawOrThrow(id);
    throw new BadRequestException(
      `Direct locking is disabled (current status: ${run.status}). Submit the completed run to Accounts; Finance approval locks it automatically.`,
    );
  }

  async submit(id: string, user: AuthenticatedUser): Promise<PayrollRunEntity> {
    const run = await this.findRawOrThrow(id);
    if (run.status !== PayrollRunStatus.COMPLETED) {
      throw new BadRequestException(
        'Only a COMPLETED payroll run can be submitted',
      );
    }
    const updated = await this.prisma.payrollRun.update({
      where: { id },
      data: {
        status: PayrollRunStatus.PENDING_APPROVAL,
        submittedById: user.id,
        submittedAt: new Date(),
      },
    });
    return this.toEntity(updated);
  }

  async accountsQueue(user: AuthenticatedUser) {
    await this.financeAccess.assertCanUseFinance(user);
    const runs = await this.prisma.payrollRun.findMany({
      where: {
        status: {
          in: [
            PayrollRunStatus.PENDING_APPROVAL,
            PayrollRunStatus.APPROVED,
            PayrollRunStatus.LOCKED,
            PayrollRunStatus.PAID,
          ],
        },
      },
      include: { payslips: true },
      orderBy: [{ year: 'desc' }, { month: 'desc' }],
    });
    return runs.map((run) => {
      const totals = this.totals(run.payslips);
      return {
        ...this.toEntity(run),
        employeeCount: totals.employeeCount,
        grossEarnings: totals.grossEarnings.toString(),
        unpaidLeaveDeduction: totals.unpaidLeaveDeduction.toString(),
        employerContributions: totals.employerContributions.toString(),
        netPay: totals.netPay.toString(),
        tds: totals.tds.toString(),
        totalExpense: totals.totalExpense.toString(),
      };
    });
  }

  async financeReview(id: string, user: AuthenticatedUser) {
    await this.financeAccess.assertCanUseFinance(user);
    const run = await this.prisma.payrollRun.findUnique({
      where: { id },
      include: {
        payslips: {
          include: {
            employee: {
              select: {
                employeeId: true,
                firstName: true,
                lastName: true,
                designation: true,
                vertical: { select: { id: true, name: true, code: true } },
              },
            },
          },
          orderBy: { employee: { firstName: 'asc' } },
        },
      },
    });
    if (!run) throw new NotFoundException('Payroll run not found');
    if (run.status === PayrollRunStatus.DRAFT) {
      throw new BadRequestException('Payroll has not been sent to Accounts');
    }

    const totals = this.totals(run.payslips);
    const verticals = new Map<
      string,
      {
        verticalId: string | null;
        verticalName: string;
        employeeCount: number;
        grossEarnings: Prisma.Decimal;
        employerContributions: Prisma.Decimal;
        unpaidLeaveDeduction: Prisma.Decimal;
        tds: Prisma.Decimal;
        netPay: Prisma.Decimal;
        totalExpense: Prisma.Decimal;
      }
    >();
    for (const payslip of run.payslips) {
      const vertical = payslip.employee.vertical;
      const key = vertical?.id ?? 'unassigned';
      const row = verticals.get(key) ?? {
        verticalId: vertical?.id ?? null,
        verticalName: vertical?.name ?? 'Not assigned',
        employeeCount: 0,
        grossEarnings: new Prisma.Decimal(0),
        employerContributions: new Prisma.Decimal(0),
        unpaidLeaveDeduction: new Prisma.Decimal(0),
        tds: new Prisma.Decimal(0),
        netPay: new Prisma.Decimal(0),
        totalExpense: new Prisma.Decimal(0),
      };
      const employer = payslip.pfEmployer.plus(payslip.esiEmployer ?? 0);
      row.employeeCount += 1;
      row.grossEarnings = row.grossEarnings.plus(payslip.grossEarnings);
      row.employerContributions = row.employerContributions.plus(employer);
      row.unpaidLeaveDeduction = row.unpaidLeaveDeduction.plus(
        payslip.unpaidLeaveDeduction,
      );
      row.tds = row.tds.plus(payslip.tdsDeducted);
      row.netPay = row.netPay.plus(payslip.netPay);
      row.totalExpense = row.totalExpense.plus(
        payslip.grossEarnings
          .minus(payslip.unpaidLeaveDeduction)
          .plus(employer),
      );
      verticals.set(key, row);
    }

    const serialize = (value: Prisma.Decimal) => value.toString();
    return {
      ...this.toEntity(run),
      totals: {
        employeeCount: totals.employeeCount,
        grossEarnings: serialize(totals.grossEarnings),
        employerContributions: serialize(totals.employerContributions),
        unpaidLeaveDeduction: serialize(totals.unpaidLeaveDeduction),
        tds: serialize(totals.tds),
        netPay: serialize(totals.netPay),
        totalExpense: serialize(totals.totalExpense),
        averageNetPay: totals.employeeCount
          ? serialize(totals.netPay.div(totals.employeeCount))
          : '0',
      },
      verticals: [...verticals.values()]
        .sort((a, b) => b.totalExpense.comparedTo(a.totalExpense))
        .map((row) => ({
          ...row,
          grossEarnings: serialize(row.grossEarnings),
          employerContributions: serialize(row.employerContributions),
          unpaidLeaveDeduction: serialize(row.unpaidLeaveDeduction),
          tds: serialize(row.tds),
          netPay: serialize(row.netPay),
          totalExpense: serialize(row.totalExpense),
        })),
      payslips: run.payslips.map((payslip) => ({
        ...this.toPayslipEntity(payslip),
        employee: payslip.employee,
      })),
    };
  }

  async approve(id: string, user: AuthenticatedUser) {
    await this.financeAccess.assertAccountsHead(user);
    const run = await this.prisma.payrollRun.findUnique({
      where: { id },
      include: { payslips: true },
    });
    if (!run) throw new NotFoundException('Payroll run not found');
    if (run.status !== PayrollRunStatus.PENDING_APPROVAL)
      throw new BadRequestException('Payroll run is not awaiting approval');
    if (run.initiatedById === user.id || run.submittedById === user.id)
      throw new BadRequestException(
        'The payroll maker cannot approve the same run',
      );
    const totals = this.totals(run.payslips);
    return this.prisma.$transaction(async (tx) => {
      const [expense, accrued, tds] = await Promise.all([
        this.account(tx, '6000'),
        this.account(tx, '2400'),
        this.account(tx, '2200'),
      ]);
      const journal = await this.finance.postJournalTx(tx, {
        entryDate: endOfMonth(new Date(Date.UTC(run.year, run.month - 1, 1))),
        description: `Payroll accrual ${run.month}/${run.year}`,
        reference: `PAYROLL-${run.year}-${String(run.month).padStart(2, '0')}`,
        createdById: run.initiatedById,
        submittedById: run.submittedById,
        submittedAt: run.submittedAt,
        approvedById: user.id,
        lines: [
          { accountId: expense.id, debit: totals.totalExpense, credit: 0 },
          { accountId: accrued.id, debit: 0, credit: totals.nonTdsPayable },
          { accountId: tds.id, debit: 0, credit: totals.tds },
        ],
      });
      return tx.payrollRun.update({
        where: { id },
        data: {
          status: PayrollRunStatus.APPROVED,
          approvedById: user.id,
          approvedAt: new Date(),
          lockedAt: new Date(),
          accrualJournalEntryId: journal.id,
        },
      });
    });
  }

  async executePayment(
    id: string,
    bankReference: string,
    user: AuthenticatedUser,
  ) {
    await this.financeAccess.assertCanUseFinance(user);
    if (!bankReference?.trim())
      throw new BadRequestException('Bank reference is required');
    const run = await this.prisma.payrollRun.findUnique({
      where: { id },
      include: { payslips: true },
    });
    if (!run) throw new NotFoundException('Payroll run not found');
    if (
      ![PayrollRunStatus.APPROVED, PayrollRunStatus.LOCKED].includes(
        run.status as any,
      )
    )
      throw new BadRequestException('Only an approved payroll run can be paid');
    const totals = this.totals(run.payslips);
    return this.prisma.$transaction(async (tx) => {
      const [accrued, bank] = await Promise.all([
        this.account(tx, '2400'),
        this.account(tx, '1000'),
      ]);
      const journal = await this.finance.postJournalTx(tx, {
        entryDate: new Date(),
        description: `Salary payment ${run.month}/${run.year}`,
        reference: bankReference.trim(),
        createdById: user.id,
        approvedById: run.approvedById ?? user.id,
        lines: [
          { accountId: accrued.id, debit: totals.netPay, credit: 0 },
          { accountId: bank.id, debit: 0, credit: totals.netPay },
        ],
      });
      await tx.payslip.updateMany({
        where: { payrollRunId: id },
        data: { status: 'PAID' },
      });
      return tx.payrollRun.update({
        where: { id },
        data: {
          status: PayrollRunStatus.PAID,
          paidAt: new Date(),
          paymentBankReference: bankReference.trim(),
          paymentJournalEntryId: journal.id,
        },
      });
    });
  }

  private totals(payslips: Payslip[]) {
    const sum = (pick: (p: Payslip) => Prisma.Decimal | null) =>
      payslips.reduce(
        (total, p) => total.plus(pick(p) ?? 0),
        new Prisma.Decimal(0),
      );
    const gross = sum((p) => p.grossEarnings);
    const unpaid = sum((p) => p.unpaidLeaveDeduction);
    const employer = sum((p) => p.pfEmployer).plus(sum((p) => p.esiEmployer));
    const tds = sum((p) => p.tdsDeducted);
    const netPay = sum((p) => p.netPay);
    const totalExpense = gross.minus(unpaid).plus(employer);
    return {
      employeeCount: payslips.length,
      grossEarnings: gross,
      unpaidLeaveDeduction: unpaid,
      employerContributions: employer,
      netPay,
      tds,
      totalExpense,
      nonTdsPayable: totalExpense.minus(tds),
    };
  }

  private async account(tx: Prisma.TransactionClient, code: string) {
    const account = await tx.ledgerAccount.findUnique({ where: { code } });
    if (!account?.isActive)
      throw new BadRequestException(
        `Required payroll ledger ${code} is missing or inactive`,
      );
    return account;
  }

  private async findRawOrThrow(id: string): Promise<PayrollRun> {
    const run = await this.prisma.payrollRun.findUnique({ where: { id } });
    if (!run) {
      throw new NotFoundException('Payroll run not found');
    }
    return run;
  }

  private toEntity(run: PayrollRun): PayrollRunEntity {
    return new PayrollRunEntity({
      id: run.id,
      month: run.month,
      year: run.year,
      status: run.status,
      initiatedById: run.initiatedById,
      processedAt: run.processedAt,
      lockedAt: run.lockedAt,
      submittedAt: run.submittedAt,
      approvedAt: run.approvedAt,
      paidAt: run.paidAt,
      paymentBankReference: run.paymentBankReference,
      createdAt: run.createdAt,
    });
  }

  /** Mirrors PayslipsService's private mapper — same shape, same rules. */
  private toPayslipEntity(payslip: Payslip): PayslipEntity {
    return new PayslipEntity({
      id: payslip.id,
      payrollRunId: payslip.payrollRunId,
      employeeId: payslip.employeeId,
      grossEarnings: payslip.grossEarnings.toString(),
      basicPaid: payslip.basicPaid.toString(),
      hraPaid: payslip.hraPaid.toString(),
      specialAllowancePaid: payslip.specialAllowancePaid.toString(),
      otherAllowancesPaid: payslip.otherAllowancesPaid.toString(),
      pfEmployee: payslip.pfEmployee.toString(),
      pfEmployer: payslip.pfEmployer.toString(),
      esiEmployee: payslip.esiEmployee?.toString() ?? null,
      esiEmployer: payslip.esiEmployer?.toString() ?? null,
      professionalTax: payslip.professionalTax?.toString() ?? null,
      tdsDeducted: payslip.tdsDeducted.toString(),
      unpaidLeaveDeduction: payslip.unpaidLeaveDeduction.toString(),
      netPay: payslip.netPay.toString(),
      statutoryConfigSnapshot: payslip.statutoryConfigSnapshot as Record<
        string,
        unknown
      >,
      status: payslip.status,
      createdAt: payslip.createdAt,
    });
  }
}
