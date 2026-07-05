import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { EmployeeStatus, LeaveAccrualType } from '@prisma/client';
import { PrismaService } from '../../core/database/prisma.service';
import { endOfMonth, monthKey } from '../../common/utils/date.util';
import { LeaveBalancesService } from './leave-balances.service';

/**
 * Monthly EL (Earned Leave) accrual: credits 1.5 days to every active
 * employee whose dateOfJoining falls on or before the end of the month
 * being credited (mid-month joiners still get that month's credit — no
 * partial-month splitting). Idempotent via LeaveBalance.lastAccrualMonth:
 * a duplicate run in the same month (e.g. a redeploy) is a no-op.
 */
@Injectable()
export class LeaveAccrualService {
  private readonly logger = new Logger(LeaveAccrualService.name);
  private static readonly MONTHLY_ACCRUAL_DAYS = 1.5;

  constructor(
    private readonly prisma: PrismaService,
    private readonly leaveBalances: LeaveBalancesService,
  ) {}

  // Runs at 10:00 on the 1st of every month, IST. The @Cron decorator
  // evaluates before ConfigService exists, so this is a literal matching
  // the TIMEZONE config default (Asia/Kolkata) — keep them in sync if
  // TIMEZONE is ever changed for a deployment.
  @Cron('0 10 1 * *', { timeZone: 'Asia/Kolkata' })
  async handleMonthlyAccrual(): Promise<void> {
    const result = await this.run(new Date());
    this.logger.log(
      `Monthly EL accrual: ${result.credited} credited, ${result.skipped} already up to date`,
    );
  }

  /** Runs the same accrual logic on demand — also used by POST /leave-accrual/run. */
  async run(asOf: Date): Promise<{ credited: number; skipped: number }> {
    const key = monthKey(asOf);
    const monthEnd = endOfMonth(asOf);
    const year = asOf.getUTCFullYear();

    const leaveType = await this.prisma.leaveType.findFirst({
      where: { accrualType: LeaveAccrualType.MONTHLY_ACCRUAL, isActive: true },
    });
    if (!leaveType) {
      return { credited: 0, skipped: 0 };
    }

    // A null dateOfJoining (e.g. employees created via the direct-admin
    // POST /employees flow rather than HR onboarding) means "eligible" —
    // Prisma's `lte` on a nullable column excludes NULLs at the SQL level,
    // so it must be OR'd in explicitly rather than relying on the filter
    // alone.
    const employees = await this.prisma.employee.findMany({
      where: {
        status: EmployeeStatus.ACTIVE,
        OR: [{ dateOfJoining: null }, { dateOfJoining: { lte: monthEnd } }],
      },
    });

    let credited = 0;
    let skipped = 0;

    for (const employee of employees) {
      const balances = await this.leaveBalances.ensureBalances(
        employee.id,
        year,
      );
      const elBalance = balances.find((b) => b.leaveTypeId === leaveType.id);
      if (!elBalance) {
        continue;
      }
      if (elBalance.lastAccrualMonth === key) {
        skipped += 1;
        continue;
      }

      const cap = leaveType.annualQuota
        ? Number(leaveType.annualQuota)
        : Infinity;
      const nextAllocated = Math.min(
        Number(elBalance.allocated) + LeaveAccrualService.MONTHLY_ACCRUAL_DAYS,
        cap,
      );

      await this.prisma.leaveBalance.update({
        where: { id: elBalance.id },
        data: { allocated: nextAllocated, lastAccrualMonth: key },
      });
      credited += 1;
    }

    return { credited, skipped };
  }
}
