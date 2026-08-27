import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { BidStrategyActionStatus, Prisma } from '@prisma/client';
import { AuthenticatedUser } from '../../common/decorators/current-user.decorator';
import { PrismaService } from '../../core/database/prisma.service';
import { SalesAccessService } from './common/sales-access.service';
import {
  CreateBidStrategyMeetingDto,
  UpdateBidStrategyActionStatusDto,
} from './dto/bid-strategy-meeting.dto';

const STRATEGY_INCLUDE = {
  createdBy: { select: { firstName: true, lastName: true } },
  attendees: {
    orderBy: { createdAt: 'asc' as const },
    include: {
      employee: { select: { firstName: true, lastName: true, email: true } },
    },
  },
  actionItems: {
    orderBy: { createdAt: 'asc' as const },
    include: { owner: { select: { firstName: true, lastName: true } } },
  },
} satisfies Prisma.BidStrategyMeetingInclude;

@Injectable()
export class BidStrategyMeetingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: SalesAccessService,
  ) {}

  async list(bidId: string, user: AuthenticatedUser) {
    await this.assertBidAccess(bidId, user);
    const rows = await this.prisma.bidStrategyMeeting.findMany({
      where: { bidId },
      include: STRATEGY_INCLUDE,
      orderBy: [{ meetingDate: 'desc' }, { createdAt: 'desc' }],
    });
    return rows.map((row) => this.toEntity(row));
  }

  async employeeOptions(bidId: string, user: AuthenticatedUser) {
    await this.assertBidAccess(bidId, user);
    return this.prisma.employee.findMany({
      where: { status: 'ACTIVE' },
      select: { id: true, firstName: true, lastName: true, employeeId: true },
      orderBy: [{ firstName: 'asc' }, { lastName: 'asc' }],
    });
  }

  async create(
    bidId: string,
    dto: CreateBidStrategyMeetingDto,
    user: AuthenticatedUser,
  ) {
    await this.assertBidAccess(bidId, user);
    if (dto.meetingMode === 'VIRTUAL' && !dto.meetingLink?.trim()) {
      throw new BadRequestException(
        'A meeting link is required for a virtual strategy meeting',
      );
    }
    for (const attendee of dto.attendees) {
      if (!!attendee.employeeId === !!attendee.externalName?.trim()) {
        throw new BadRequestException(
          'Each attendee must be either an internal employee or an external name',
        );
      }
    }
    const employeeIds = [
      ...dto.attendees.flatMap((attendee) =>
        attendee.employeeId ? [attendee.employeeId] : [],
      ),
      ...(dto.actionItems ?? []).map((item) => item.ownerId),
    ];
    const employees = await this.prisma.employee.count({
      where: { id: { in: [...new Set(employeeIds)] }, status: 'ACTIVE' },
    });
    if (employees !== new Set(employeeIds).size) {
      throw new BadRequestException(
        'An attendee or action owner is unavailable',
      );
    }
    const row = await this.prisma.bidStrategyMeeting.create({
      data: {
        bidId,
        meetingDate: new Date(dto.meetingDate),
        meetingMode: dto.meetingMode,
        meetingLink: dto.meetingLink?.trim() || null,
        notes: dto.notes.trim(),
        createdById: user.id,
        attendees: {
          create: dto.attendees.map((attendee) => ({
            employeeId: attendee.employeeId ?? null,
            externalName: attendee.externalName?.trim() || null,
          })),
        },
        actionItems: {
          create: (dto.actionItems ?? []).map((item) => ({
            description: item.description.trim(),
            ownerId: item.ownerId,
            dueDate: item.dueDate ? new Date(item.dueDate) : null,
          })),
        },
      },
      include: STRATEGY_INCLUDE,
    });
    return this.toEntity(row);
  }

  async updateActionStatus(
    bidId: string,
    actionItemId: string,
    dto: UpdateBidStrategyActionStatusDto,
    user: AuthenticatedUser,
  ) {
    await this.assertBidAccess(bidId, user);
    const item = await this.prisma.bidStrategyActionItem.findFirst({
      where: { id: actionItemId, meeting: { bidId } },
      select: { id: true },
    });
    if (!item) throw new NotFoundException('Strategy action item not found');
    return this.prisma.bidStrategyActionItem.update({
      where: { id: item.id },
      data: { status: dto.status },
    });
  }

  private async assertBidAccess(bidId: string, user: AuthenticatedUser) {
    await this.access.assertSalesAccess(user);
    const bid = await this.prisma.bid.findUnique({
      where: { id: bidId },
      select: { createdById: true },
    });
    if (!bid) throw new NotFoundException('Bid not found');
    await this.access.assertCanAccessOwned(user, bid.createdById);
  }

  private toEntity(
    row: Prisma.BidStrategyMeetingGetPayload<{
      include: typeof STRATEGY_INCLUDE;
    }>,
  ) {
    const name = (employee: { firstName: string; lastName: string }) =>
      `${employee.firstName} ${employee.lastName}`.trim();
    return {
      id: row.id,
      bidId: row.bidId,
      meetingDate: row.meetingDate.toISOString(),
      meetingMode: row.meetingMode,
      meetingLink: row.meetingLink,
      notes: row.notes,
      createdByName: name(row.createdBy),
      createdAt: row.createdAt.toISOString(),
      attendees: row.attendees.map((attendee) => ({
        id: attendee.id,
        employeeId: attendee.employeeId,
        externalName: attendee.externalName,
        displayName: attendee.employee
          ? name(attendee.employee)
          : attendee.externalName,
        email: attendee.employee?.email ?? null,
        isInternal: !!attendee.employeeId,
      })),
      actionItems: row.actionItems.map((item) => ({
        id: item.id,
        description: item.description,
        ownerId: item.ownerId,
        ownerName: name(item.owner),
        dueDate: item.dueDate?.toISOString() ?? null,
        status: item.status,
      })),
    };
  }
}
