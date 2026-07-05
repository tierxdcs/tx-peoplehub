import { BadRequestException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Attendance, LeaveRequestStatus } from '@prisma/client';
import { PrismaService } from '../../core/database/prisma.service';
import {
  PaginatedResult,
  PaginationQueryDto,
} from '../../common/dto/pagination.dto';
import { toDateOnly, todayInTimezone } from '../../common/utils/date.util';
import { CorrectAttendanceDto } from './dto/correct-attendance.dto';
import {
  AttendanceEntity,
  AttendanceStatus,
} from './entities/attendance.entity';

@Injectable()
export class AttendanceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  async checkIn(employeeId: string): Promise<AttendanceEntity> {
    const today = this.today();
    const existing = await this.prisma.attendance.findUnique({
      where: { employeeId_date: { employeeId, date: today } },
    });
    if (existing?.checkInTime) {
      throw new BadRequestException('Already checked in today');
    }

    const record = existing
      ? await this.prisma.attendance.update({
          where: { id: existing.id },
          data: { checkInTime: new Date() },
        })
      : await this.prisma.attendance.create({
          data: { employeeId, date: today, checkInTime: new Date() },
        });

    return this.toEntity(record);
  }

  async checkOut(employeeId: string): Promise<AttendanceEntity> {
    const today = this.today();
    const existing = await this.prisma.attendance.findUnique({
      where: { employeeId_date: { employeeId, date: today } },
    });
    if (!existing?.checkInTime) {
      throw new BadRequestException('Must check in before checking out');
    }
    if (existing.checkOutTime) {
      throw new BadRequestException('Already checked out today');
    }

    const record = await this.prisma.attendance.update({
      where: { id: existing.id },
      data: { checkOutTime: new Date() },
    });
    return this.toEntity(record);
  }

  async getOwn(
    employeeId: string,
    query: PaginationQueryDto,
  ): Promise<PaginatedResult<AttendanceEntity>> {
    const where = { employeeId };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.attendance.findMany({
        where,
        skip: query.skip,
        take: query.limit,
        orderBy: { date: 'desc' },
      }),
      this.prisma.attendance.count({ where }),
    ]);
    return {
      items: await this.toEntities(items),
      total,
      page: query.page,
      limit: query.limit,
    };
  }

  async getForEmployees(
    employeeIds: string[],
    from: Date,
    to: Date,
  ): Promise<AttendanceEntity[]> {
    if (employeeIds.length === 0) {
      return [];
    }
    const records = await this.prisma.attendance.findMany({
      where: { employeeId: { in: employeeIds }, date: { gte: from, lte: to } },
      orderBy: { date: 'desc' },
    });
    return this.toEntities(records);
  }

  /**
   * Admin/SuperAdmin lookup of a single employee/date record, for the
   * correction screen to pre-fill against — `null` (not a 404) when no
   * record exists yet, since most dates have none until checked-in or
   * corrected.
   */
  async getOne(
    employeeId: string,
    dateParam: string,
  ): Promise<AttendanceEntity | null> {
    const date = toDateOnly(new Date(dateParam));
    const record = await this.prisma.attendance.findUnique({
      where: { employeeId_date: { employeeId, date } },
    });
    if (!record) {
      return null;
    }
    const [entity] = await this.toEntities([record]);
    return entity;
  }

  /**
   * Admin/SuperAdmin manual correction — sets times directly, never
   * `status` (always re-derived on read). Upserts so a forgotten day can
   * be backfilled, not just an existing record edited.
   */
  async correct(
    employeeId: string,
    dateParam: string,
    dto: CorrectAttendanceDto,
  ): Promise<AttendanceEntity> {
    const date = toDateOnly(new Date(dateParam));
    const record = await this.prisma.attendance.upsert({
      where: { employeeId_date: { employeeId, date } },
      update: {
        ...(dto.checkInTime !== undefined
          ? { checkInTime: dto.checkInTime ? new Date(dto.checkInTime) : null }
          : {}),
        ...(dto.checkOutTime !== undefined
          ? {
              checkOutTime: dto.checkOutTime
                ? new Date(dto.checkOutTime)
                : null,
            }
          : {}),
      },
      create: {
        employeeId,
        date,
        checkInTime: dto.checkInTime ? new Date(dto.checkInTime) : null,
        checkOutTime: dto.checkOutTime ? new Date(dto.checkOutTime) : null,
      },
    });
    const [entity] = await this.toEntities([record]);
    return entity;
  }

  private today(): Date {
    const timezone = this.config.get<string>('timezone') as string;
    return todayInTimezone(timezone);
  }

  private async toEntities(records: Attendance[]): Promise<AttendanceEntity[]> {
    if (records.length === 0) {
      return [];
    }
    const employeeIds = [...new Set(records.map((r) => r.employeeId))];
    const approvedLeaves = await this.prisma.leaveRequest.findMany({
      where: {
        employeeId: { in: employeeIds },
        status: LeaveRequestStatus.APPROVED,
      },
      select: { employeeId: true, startDate: true, endDate: true },
    });

    const today = this.today();
    return records.map((record) => {
      const onLeave = approvedLeaves.some(
        (leave) =>
          leave.employeeId === record.employeeId &&
          leave.startDate <= record.date &&
          leave.endDate >= record.date,
      );
      return this.toEntity(record, onLeave, today);
    });
  }

  private toEntity(
    record: Attendance,
    onLeave = false,
    today: Date = this.today(),
  ): AttendanceEntity {
    return new AttendanceEntity({
      id: record.id,
      employeeId: record.employeeId,
      date: record.date,
      checkInTime: record.checkInTime,
      checkOutTime: record.checkOutTime,
      status: this.deriveStatus(record, onLeave, today),
    });
  }

  /**
   * ON_LEAVE beats everything; both times -> PRESENT; only check-in on a
   * past day -> HALF_DAY (today it's still in progress, treated
   * optimistically as PRESENT rather than prematurely marked half-day);
   * only check-out -> HALF_DAY; neither -> ABSENT.
   */
  private deriveStatus(
    record: Attendance,
    onLeave: boolean,
    today: Date,
  ): AttendanceStatus {
    if (onLeave) {
      return 'ON_LEAVE';
    }
    const hasCheckIn = !!record.checkInTime;
    const hasCheckOut = !!record.checkOutTime;

    if (hasCheckIn && hasCheckOut) {
      return 'PRESENT';
    }
    if (hasCheckIn && !hasCheckOut) {
      return toDateOnly(record.date) < today ? 'HALF_DAY' : 'PRESENT';
    }
    if (!hasCheckIn && hasCheckOut) {
      return 'HALF_DAY';
    }
    return 'ABSENT';
  }
}
