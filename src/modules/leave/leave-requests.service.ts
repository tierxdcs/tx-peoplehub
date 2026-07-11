import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  Employee,
  LeaveAccrualType,
  LeaveRequest,
  LeaveRequestStatus,
  Prisma,
  Role,
} from '@prisma/client';
import { PrismaService } from '../../core/database/prisma.service';
import { AuthenticatedUser } from '../../common/decorators/current-user.decorator';
import {
  PaginatedResult,
  PaginationQueryDto,
} from '../../common/dto/pagination.dto';
import {
  daysBetweenInclusive,
  toDateOnly,
  todayInTimezone,
} from '../../common/utils/date.util';
import { CreateLeaveRequestDto } from './dto/create-leave-request.dto';
import { LeaveBalancesService } from './leave-balances.service';
import { LeaveRequestEntity } from './entities/leave-request.entity';

function isAdmin(user: AuthenticatedUser): boolean {
  return user.role === Role.ADMIN || user.role === Role.SUPER_ADMIN;
}

@Injectable()
export class LeaveRequestsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly leaveBalances: LeaveBalancesService,
    private readonly config: ConfigService,
  ) {}

  async create(
    dto: CreateLeaveRequestDto,
    currentUser: AuthenticatedUser,
  ): Promise<LeaveRequestEntity> {
    const requester = await this.findEmployeeOrThrow(currentUser.id);
    const leaveType = await this.prisma.leaveType.findUnique({
      where: { id: dto.leaveTypeId },
    });
    if (!leaveType || !leaveType.isActive) {
      throw new BadRequestException(
        'leaveTypeId does not reference an active leave type',
      );
    }

    const startDate = toDateOnly(new Date(dto.startDate));
    const endDate = toDateOnly(new Date(dto.endDate));
    if (endDate < startDate) {
      throw new BadRequestException('endDate cannot be before startDate');
    }
    this.validateNumberOfDays(dto.numberOfDays, startDate, endDate);
    await this.assertNoOverlap(requester.id, startDate, endDate);

    const isTracked = leaveType.accrualType !== LeaveAccrualType.UNTRACKED;
    const isSuperAdmin = requester.role === Role.SUPER_ADMIN;

    if (isSuperAdmin) {
      if (isTracked) {
        // Ensures this year's balance row exists before the transaction
        // checks/deducts it — create() can be the very first tracked-leave
        // action for this employee/year.
        await this.leaveBalances.ensureBalances(
          requester.id,
          startDate.getUTCFullYear(),
        );
      }
      const request = await this.prisma.$transaction(async (tx) => {
        if (isTracked) {
          await this.assertSufficientBalance(
            requester.id,
            leaveType.id,
            startDate.getUTCFullYear(),
            dto.numberOfDays,
            tx,
          );
          await this.adjustBalanceUsed(
            requester.id,
            leaveType.id,
            startDate.getUTCFullYear(),
            dto.numberOfDays,
            tx,
          );
        }
        return tx.leaveRequest.create({
          data: {
            employeeId: requester.id,
            leaveTypeId: leaveType.id,
            startDate,
            endDate,
            numberOfDays: dto.numberOfDays,
            reason: dto.reason,
            status: LeaveRequestStatus.APPROVED,
            approvedAt: new Date(),
            approverComments:
              'Auto-approved: no reporting manager (SUPER_ADMIN)',
            // The requester is effectively their own approver here — snapshot
            // their signature (null-safe).
            approverSignatureTextSnapshot: requester.signatureText ?? null,
            approverSignatureFontSnapshot: requester.signatureFont ?? null,
          },
        });
      });
      return this.toEntity(request);
    }

    const request = await this.prisma.leaveRequest.create({
      data: {
        employeeId: requester.id,
        leaveTypeId: leaveType.id,
        startDate,
        endDate,
        numberOfDays: dto.numberOfDays,
        reason: dto.reason,
        status: LeaveRequestStatus.PENDING,
      },
    });
    return this.toEntity(request);
  }

  async getOwn(
    employeeId: string,
    query: PaginationQueryDto,
  ): Promise<PaginatedResult<LeaveRequestEntity>> {
    const where = { employeeId };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.leaveRequest.findMany({
        where,
        skip: query.skip,
        take: query.limit,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.leaveRequest.count({ where }),
    ]);
    return {
      items: items.map((r) => this.toEntity(r)),
      total,
      page: query.page,
      limit: query.limit,
    };
  }

  /**
   * The scoped where-clause for the caller's pending-approval queue: Admins see
   * every PENDING request company-wide; everyone else sees only their DIRECT
   * reports' requests. Shared by the list and its count so they can't drift.
   */
  private pendingApprovalWhere(
    currentUser: AuthenticatedUser,
  ): Prisma.LeaveRequestWhereInput {
    return isAdmin(currentUser)
      ? { status: LeaveRequestStatus.PENDING }
      : {
          status: LeaveRequestStatus.PENDING,
          employee: { reportingManagerId: currentUser.id },
        };
  }

  /** Count of requests awaiting the caller's approval (reuses the same scope). */
  async countPendingApproval(currentUser: AuthenticatedUser): Promise<number> {
    return this.prisma.leaveRequest.count({
      where: this.pendingApprovalWhere(currentUser),
    });
  }

  async getPendingApproval(
    currentUser: AuthenticatedUser,
    query: PaginationQueryDto,
  ): Promise<PaginatedResult<LeaveRequestEntity>> {
    const where = this.pendingApprovalWhere(currentUser);

    const [items, total] = await this.prisma.$transaction([
      this.prisma.leaveRequest.findMany({
        where,
        skip: query.skip,
        take: query.limit,
        orderBy: { createdAt: 'asc' },
      }),
      this.prisma.leaveRequest.count({ where }),
    ]);
    return {
      items: items.map((r) => this.toEntity(r)),
      total,
      page: query.page,
      limit: query.limit,
    };
  }

  async approve(
    id: string,
    currentUser: AuthenticatedUser,
    approverComments: string | undefined,
  ): Promise<LeaveRequestEntity> {
    const request = await this.findRequestOrThrow(id);
    await this.assertCanActOnRequest(request, currentUser);

    if (request.status !== LeaveRequestStatus.PENDING) {
      throw new BadRequestException('Only PENDING requests can be approved');
    }

    const leaveType = await this.prisma.leaveType.findUniqueOrThrow({
      where: { id: request.leaveTypeId },
    });
    const isTracked = leaveType.accrualType !== LeaveAccrualType.UNTRACKED;
    const year = request.startDate.getUTCFullYear();
    const numberOfDays = Number(request.numberOfDays);

    if (isTracked) {
      // Balance is checked/deducted here, not at request-submission time
      // (per spec §3) — this may be the first tracked-leave action for
      // this employee/year, so ensure the row exists first.
      await this.leaveBalances.ensureBalances(request.employeeId, year);
    }

    // Snapshot the approving manager's e-signature at approval time (null-safe).
    const approver = await this.prisma.employee.findUnique({
      where: { id: currentUser.id },
      select: { signatureText: true, signatureFont: true },
    });

    const updated = await this.prisma.$transaction(async (tx) => {
      if (isTracked) {
        await this.assertSufficientBalance(
          request.employeeId,
          request.leaveTypeId,
          year,
          numberOfDays,
          tx,
        );
        await this.adjustBalanceUsed(
          request.employeeId,
          request.leaveTypeId,
          year,
          numberOfDays,
          tx,
        );
      }
      return tx.leaveRequest.update({
        where: { id },
        data: {
          status: LeaveRequestStatus.APPROVED,
          approverId: currentUser.id,
          approvedAt: new Date(),
          approverComments: approverComments ?? null,
          approverSignatureTextSnapshot: approver?.signatureText ?? null,
          approverSignatureFontSnapshot: approver?.signatureFont ?? null,
        },
      });
    });

    return this.toEntity(updated);
  }

  async reject(
    id: string,
    currentUser: AuthenticatedUser,
    approverComments: string | undefined,
  ): Promise<LeaveRequestEntity> {
    const request = await this.findRequestOrThrow(id);
    await this.assertCanActOnRequest(request, currentUser);

    if (request.status !== LeaveRequestStatus.PENDING) {
      throw new BadRequestException('Only PENDING requests can be rejected');
    }

    const updated = await this.prisma.leaveRequest.update({
      where: { id },
      data: {
        status: LeaveRequestStatus.REJECTED,
        approverId: currentUser.id,
        approvedAt: new Date(),
        approverComments: approverComments ?? null,
      },
    });
    return this.toEntity(updated);
  }

  async cancel(
    id: string,
    currentUser: AuthenticatedUser,
  ): Promise<LeaveRequestEntity> {
    const request = await this.findRequestOrThrow(id);

    const isRequester = request.employeeId === currentUser.id;
    const isApprover = request.approverId === currentUser.id;
    if (!isRequester && !isApprover) {
      throw new ForbiddenException(
        'Only the requester or approver may cancel this request',
      );
    }

    if (
      request.status !== LeaveRequestStatus.PENDING &&
      request.status !== LeaveRequestStatus.APPROVED
    ) {
      throw new BadRequestException(
        'Only PENDING or APPROVED requests can be cancelled',
      );
    }

    const timezone = this.config.get<string>('timezone') as string;
    const today = todayInTimezone(timezone);
    if (toDateOnly(request.startDate) <= today) {
      throw new BadRequestException(
        'Requests can only be cancelled before their startDate',
      );
    }

    const wasApproved = request.status === LeaveRequestStatus.APPROVED;
    const leaveType = await this.prisma.leaveType.findUniqueOrThrow({
      where: { id: request.leaveTypeId },
    });
    const isTracked = leaveType.accrualType !== LeaveAccrualType.UNTRACKED;

    const updated = await this.prisma.$transaction(async (tx) => {
      if (wasApproved && isTracked) {
        await this.adjustBalanceUsed(
          request.employeeId,
          request.leaveTypeId,
          request.startDate.getUTCFullYear(),
          -Number(request.numberOfDays),
          tx,
        );
      }
      return tx.leaveRequest.update({
        where: { id },
        data: { status: LeaveRequestStatus.CANCELLED },
      });
    });

    return this.toEntity(updated);
  }

  /**
   * Self-approval is always blocked. Otherwise Admin can act on anything;
   * a MANAGER only if they are the resolved approver. Resolution walks
   * requester.reportingManagerId directly (per the hierarchy field) with a
   * defensive one-level escalation if that ever equals the requester —
   * structurally unreachable today since reportingManagerId can never
   * self-reference, kept as insurance.
   */
  private async assertCanActOnRequest(
    request: LeaveRequest,
    currentUser: AuthenticatedUser,
  ): Promise<void> {
    if (request.employeeId === currentUser.id) {
      throw new ForbiddenException(
        'Cannot approve or reject your own leave request',
      );
    }
    if (isAdmin(currentUser)) {
      return;
    }

    const approverId = await this.resolveApprover(request.employeeId);
    if (approverId !== currentUser.id) {
      throw new ForbiddenException(
        'Only the requester’s manager (or an Admin) may act on this request',
      );
    }
  }

  private async resolveApprover(requesterId: string): Promise<string | null> {
    const requester = await this.prisma.employee.findUnique({
      where: { id: requesterId },
      select: { reportingManagerId: true },
    });
    let approverId = requester?.reportingManagerId ?? null;

    if (approverId === requesterId) {
      const manager = await this.prisma.employee.findUnique({
        where: { id: approverId },
        select: { reportingManagerId: true },
      });
      approverId = manager?.reportingManagerId ?? null;
    }
    return approverId;
  }

  private validateNumberOfDays(
    numberOfDays: number,
    startDate: Date,
    endDate: Date,
  ): void {
    if (numberOfDays <= 0) {
      throw new BadRequestException('numberOfDays must be positive');
    }
    if (Math.round(numberOfDays * 2) !== numberOfDays * 2) {
      throw new BadRequestException('numberOfDays must be a multiple of 0.5');
    }
    const span = daysBetweenInclusive(startDate, endDate);
    if (numberOfDays > span) {
      throw new BadRequestException(
        'numberOfDays cannot exceed the calendar days spanned by the date range',
      );
    }
  }

  private async assertNoOverlap(
    employeeId: string,
    startDate: Date,
    endDate: Date,
  ): Promise<void> {
    const overlapping = await this.prisma.leaveRequest.findFirst({
      where: {
        employeeId,
        status: {
          in: [LeaveRequestStatus.PENDING, LeaveRequestStatus.APPROVED],
        },
        startDate: { lte: endDate },
        endDate: { gte: startDate },
      },
    });
    if (overlapping) {
      throw new BadRequestException(
        'This request overlaps an existing pending or approved leave request',
      );
    }
  }

  private async assertSufficientBalance(
    employeeId: string,
    leaveTypeId: string,
    year: number,
    numberOfDays: number,
    tx: Prisma.TransactionClient,
  ): Promise<void> {
    const balance = await tx.leaveBalance.findUnique({
      where: { employeeId_leaveTypeId_year: { employeeId, leaveTypeId, year } },
    });
    const remaining = balance
      ? Number(balance.allocated) +
        Number(balance.carriedForward) -
        Number(balance.used)
      : 0;
    if (remaining < numberOfDays) {
      throw new BadRequestException(
        'Insufficient leave balance for this request',
      );
    }
  }

  private async adjustBalanceUsed(
    employeeId: string,
    leaveTypeId: string,
    year: number,
    delta: number,
    tx: Prisma.TransactionClient,
  ): Promise<void> {
    await tx.leaveBalance.update({
      where: { employeeId_leaveTypeId_year: { employeeId, leaveTypeId, year } },
      data: { used: { increment: delta } },
    });
  }

  private async findEmployeeOrThrow(id: string): Promise<Employee> {
    const employee = await this.prisma.employee.findUnique({ where: { id } });
    if (!employee) {
      throw new NotFoundException('Employee not found');
    }
    return employee;
  }

  private async findRequestOrThrow(id: string): Promise<LeaveRequest> {
    const request = await this.prisma.leaveRequest.findUnique({
      where: { id },
    });
    if (!request) {
      throw new NotFoundException('Leave request not found');
    }
    return request;
  }

  private toEntity(request: LeaveRequest): LeaveRequestEntity {
    return new LeaveRequestEntity({
      id: request.id,
      employeeId: request.employeeId,
      leaveTypeId: request.leaveTypeId,
      startDate: request.startDate,
      endDate: request.endDate,
      numberOfDays: request.numberOfDays.toString(),
      reason: request.reason,
      status: request.status,
      approverId: request.approverId,
      approvedAt: request.approvedAt,
      approverComments: request.approverComments,
      approverSignatureTextSnapshot: request.approverSignatureTextSnapshot,
      approverSignatureFontSnapshot: request.approverSignatureFontSnapshot,
      createdAt: request.createdAt,
      updatedAt: request.updatedAt,
    });
  }
}
