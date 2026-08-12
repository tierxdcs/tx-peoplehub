import { BadRequestException } from '@nestjs/common';
import { KickoffMeetingMode, Role } from '@prisma/client';
import { BidStrategyMeetingsService } from './bid-strategy-meetings.service';

describe('BidStrategyMeetingsService', () => {
  const user = {
    id: 'sales-1',
    role: Role.EMPLOYEE,
    verticalId: 'sales',
  } as any;
  let prisma: any;
  let access: any;
  let service: BidStrategyMeetingsService;

  beforeEach(() => {
    prisma = {
      bid: { findUnique: jest.fn().mockResolvedValue({ createdById: 'sales-1' }) },
      employee: { count: jest.fn().mockResolvedValue(2) },
      bidStrategyMeeting: {
        create: jest.fn().mockImplementation(({ data }) => ({
          id: 'meeting-1',
          bidId: data.bidId,
          meetingDate: data.meetingDate,
          meetingMode: data.meetingMode,
          meetingLink: data.meetingLink,
          notes: data.notes,
          createdAt: new Date(),
          createdBy: { firstName: 'Sales', lastName: 'User' },
          attendees: [{ id: 'a1', employeeId: 'e1', externalName: null, createdAt: new Date(), employee: { firstName: 'Internal', lastName: 'User', email: 'i@x.com' } }],
          actionItems: [{ id: 'x1', description: 'Follow up', ownerId: 'e2', dueDate: null, status: 'OPEN', createdAt: new Date(), updatedAt: new Date(), owner: { firstName: 'Owner', lastName: 'User' } }],
        })),
        findMany: jest.fn(),
      },
      bidStrategyActionItem: { findFirst: jest.fn(), update: jest.fn() },
    };
    access = {
      assertSalesAccess: jest.fn().mockResolvedValue(undefined),
      assertCanAccessOwned: jest.fn().mockResolvedValue(undefined),
    };
    service = new BidStrategyMeetingsService(prisma, access);
  });

  it('creates a lightweight meeting with dual attendees and no Kanban side effect', async () => {
    const result = await service.create(
      'bid-1',
      {
        meetingDate: '2026-09-10T10:00:00.000Z',
        meetingMode: KickoffMeetingMode.VIRTUAL,
        meetingLink: 'https://meet.example/test',
        notes: 'Bid approach agreed',
        attendees: [{ employeeId: 'e1' }, { externalName: 'Customer Advisor' }],
        actionItems: [{ description: 'Follow up', ownerId: 'e2' }],
      },
      user,
    );
    expect(result.id).toBe('meeting-1');
    expect(prisma.bidStrategyMeeting.create).toHaveBeenCalledTimes(1);
    expect(prisma).not.toHaveProperty('kanbanCard');
  });

  it('requires exactly one attendee identity', async () => {
    await expect(
      service.create(
        'bid-1',
        {
          meetingDate: '2026-09-10T10:00:00.000Z',
          meetingMode: KickoffMeetingMode.IN_PERSON,
          notes: 'Notes',
          attendees: [{ employeeId: 'e1', externalName: 'Duplicate identity' }],
          actionItems: [],
        },
        user,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
