import { Injectable, NotFoundException } from '@nestjs/common';
import {
  Employee,
  LeaveAccrualType,
  LeaveBalance,
  LeaveType,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../../core/database/prisma.service';
import { LeaveBalanceEntity } from './entities/leave-balance.entity';

type LeaveBalanceWithType = LeaveBalance & { leaveType: LeaveType };

/** Rounds up to the nearest 0.5 — the confirmed pro-rating rounding rule. */
function roundUpToNearestHalf(value: number): number {
  return Math.ceil(value * 2) / 2;
}

@Injectable()
export class LeaveBalancesService {
  constructor(private readonly prisma: PrismaService) {}

  async getOwnBalances(
    employeeId: string,
    year: number,
  ): Promise<LeaveBalanceEntity[]> {
    const balances = await this.ensureBalances(employeeId, year);
    return balances.map((b) => this.toEntity(b));
  }

  /**
   * Finds-or-creates the current year's balance row for every active,
   * tracked (non-UNTRACKED) leave type for `employeeId`. Reused by
   * leave-requests (balance checks) and leave-accrual (EL crediting).
   */
  async ensureBalances(
    employeeId: string,
    year: number,
  ): Promise<LeaveBalanceWithType[]> {
    const employee = await this.prisma.employee.findUnique({
      where: { id: employeeId },
    });
    if (!employee) {
      throw new NotFoundException('Employee not found');
    }

    const leaveTypes = await this.prisma.leaveType.findMany({
      where: {
        isActive: true,
        accrualType: { not: LeaveAccrualType.UNTRACKED },
      },
    });

    const results: LeaveBalanceWithType[] = [];
    for (const leaveType of leaveTypes) {
      const existing = await this.prisma.leaveBalance.findUnique({
        where: {
          employeeId_leaveTypeId_year: {
            employeeId,
            leaveTypeId: leaveType.id,
            year,
          },
        },
        include: { leaveType: true },
      });
      if (existing) {
        results.push(existing);
        continue;
      }

      const created = await this.createInitialBalance(
        employee,
        leaveType,
        year,
      );
      results.push(created);
    }
    return results;
  }

  private async createInitialBalance(
    employee: Employee,
    leaveType: LeaveType,
    year: number,
  ): Promise<LeaveBalanceWithType> {
    let allocated = new Prisma.Decimal(0);
    let carriedForward = new Prisma.Decimal(0);

    if (leaveType.accrualType === LeaveAccrualType.FIXED_ANNUAL) {
      allocated = this.proRatedAnnualQuota(employee, leaveType, year);
    } else if (leaveType.accrualType === LeaveAccrualType.MONTHLY_ACCRUAL) {
      carriedForward = await this.carryForwardFromPreviousYear(
        employee.id,
        leaveType,
        year,
      );
    }

    return this.prisma.leaveBalance.create({
      data: {
        employeeId: employee.id,
        leaveTypeId: leaveType.id,
        year,
        allocated,
        carriedForward,
      },
      include: { leaveType: true },
    });
  }

  /**
   * Full quota if joined before `year`; pro-rated by remaining months if
   * joined mid-`year` (rounded up to the nearest 0.5); 0 if joining is
   * still in the future relative to `year`.
   */
  private proRatedAnnualQuota(
    employee: Employee,
    leaveType: LeaveType,
    year: number,
  ): Prisma.Decimal {
    const quota = leaveType.annualQuota ? Number(leaveType.annualQuota) : 0;
    if (!employee.dateOfJoining) {
      return new Prisma.Decimal(quota);
    }

    const joinYear = employee.dateOfJoining.getUTCFullYear();
    if (joinYear < year) {
      return new Prisma.Decimal(quota);
    }
    if (joinYear > year) {
      return new Prisma.Decimal(0);
    }

    const joinMonth = employee.dateOfJoining.getUTCMonth() + 1; // 1-12
    const monthsRemaining = 13 - joinMonth;
    const proRated = roundUpToNearestHalf(quota * (monthsRemaining / 12));
    return new Prisma.Decimal(proRated);
  }

  /** min(carryForwardCap, previous year's remaining), or 0 if no prior row. */
  private async carryForwardFromPreviousYear(
    employeeId: string,
    leaveType: LeaveType,
    year: number,
  ): Promise<Prisma.Decimal> {
    const previous = await this.prisma.leaveBalance.findUnique({
      where: {
        employeeId_leaveTypeId_year: {
          employeeId,
          leaveTypeId: leaveType.id,
          year: year - 1,
        },
      },
    });
    if (!previous) {
      return new Prisma.Decimal(0);
    }

    const prevRemaining = previous.allocated
      .plus(previous.carriedForward)
      .minus(previous.used);
    const cap = leaveType.carryForwardCap
      ? new Prisma.Decimal(leaveType.carryForwardCap)
      : null;

    if (prevRemaining.lte(0)) {
      return new Prisma.Decimal(0);
    }
    return cap && prevRemaining.gt(cap) ? cap : prevRemaining;
  }

  private toEntity(balance: LeaveBalanceWithType): LeaveBalanceEntity {
    const remaining = balance.allocated
      .plus(balance.carriedForward)
      .minus(balance.used);
    return new LeaveBalanceEntity({
      id: balance.id,
      leaveTypeId: balance.leaveTypeId,
      leaveTypeCode: balance.leaveType.code,
      leaveTypeName: balance.leaveType.name,
      year: balance.year,
      allocated: balance.allocated.toString(),
      used: balance.used.toString(),
      carriedForward: balance.carriedForward.toString(),
      remaining: remaining.toString(),
    });
  }
}
