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

@Injectable()
export class PayrollRunsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly computation: PayrollComputationService,
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
    if (run.status !== PayrollRunStatus.COMPLETED) {
      throw new BadRequestException(
        `Only a COMPLETED run can be locked (current status: ${run.status})`,
      );
    }
    const updated = await this.prisma.payrollRun.update({
      where: { id },
      data: { status: PayrollRunStatus.LOCKED, lockedAt: new Date() },
    });
    return this.toEntity(updated);
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
