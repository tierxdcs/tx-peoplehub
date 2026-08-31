import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { EmployeeStatus, PingRecipientStatus, Role } from '@prisma/client';
import { PingsService } from './pings.service';

describe('PingsService', () => {
  const prisma = {
    employee: { count: jest.fn(), findUnique: jest.fn(), findMany: jest.fn() },
    vertical: { findUnique: jest.fn() },
    kanbanBoard: { findUnique: jest.fn() },
    ping: { create: jest.fn(), findMany: jest.fn() },
    pingRecipient: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
    },
  } as any;
  const push = { trySendToEmployees: jest.fn().mockResolvedValue({}) } as any;
  const service = new PingsService(prisma, push);
  const user = {
    id: 'sender',
    email: 'sender@test.com',
    role: Role.EMPLOYEE,
    verticalId: null,
  };

  beforeEach(() => jest.clearAllMocks());

  it('creates one recipient state per unique active employee', async () => {
    prisma.employee.count.mockResolvedValue(2);
    prisma.ping.create.mockResolvedValue({
      id: 'ping-1',
      fromEmployee: {
        id: 'sender',
        firstName: 'Send',
        lastName: 'Er',
        email: 'sender@test.com',
        employeeId: 'EMP-1',
      },
      recipients: [],
    });
    await service.create(user, {
      message: 'Please check',
      recipientIds: ['a', 'b', 'a'],
    });
    expect(prisma.ping.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          recipients: { create: [{ employeeId: 'a' }, { employeeId: 'b' }] },
        }),
      }),
    );
  });

  it('pushes to every recipient with the sender name and a message preview', async () => {
    prisma.employee.count.mockResolvedValue(2);
    prisma.ping.create.mockResolvedValue({
      id: 'ping-9',
      fromEmployee: {
        id: 'sender',
        firstName: 'Send',
        lastName: 'Er',
        email: 'sender@test.com',
        employeeId: 'EMP-1',
      },
      recipients: [],
    });
    await service.create(user, {
      message: '  Line down on bay 3  ',
      recipientIds: ['a', 'b'],
    });
    expect(push.trySendToEmployees).toHaveBeenCalledWith(
      ['a', 'b'],
      expect.objectContaining({
        title: 'Send Er pinged you',
        body: 'Line down on bay 3',
        url: '/my-pings',
        tag: 'ping:ping-9',
      }),
      'ping received',
    );
  });

  it('still sends the ping when the push channel is broken', async () => {
    // The whole point of the best-effort pattern: a push that cannot be
    // delivered must not turn a successful ping into a failed request.
    push.trySendToEmployees.mockRejectedValueOnce(new Error('VAPID missing'));
    prisma.employee.count.mockResolvedValue(1);
    prisma.ping.create.mockResolvedValue({
      id: 'ping-10',
      fromEmployee: {
        id: 'sender',
        firstName: 'Send',
        lastName: 'Er',
        email: 'sender@test.com',
        employeeId: 'EMP-1',
      },
      recipients: [],
    });
    const ping = await service.create(user, {
      message: 'Still delivered',
      recipientIds: ['a'],
    });
    expect(ping.id).toBe('ping-10');
  });

  it('does not allow a ping addressed only to its sender', async () => {
    await expect(
      service.create(user, { message: 'Self', recipientIds: ['sender'] }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('prevents one recipient from responding for another', async () => {
    prisma.pingRecipient.findUnique.mockResolvedValue({
      id: 'r1',
      employeeId: 'someone-else',
      status: PingRecipientStatus.PENDING,
    });
    await expect(
      service.updateStatus('r1', user, PingRecipientStatus.ACKNOWLEDGED),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('records acknowledgement time without changing other recipients', async () => {
    prisma.pingRecipient.findUnique.mockResolvedValue({
      id: 'r1',
      employeeId: 'sender',
      status: PingRecipientStatus.PENDING,
    });
    prisma.pingRecipient.update.mockResolvedValue({
      id: 'r1',
      status: PingRecipientStatus.ACKNOWLEDGED,
    });
    await service.updateStatus('r1', user, PingRecipientStatus.ACKNOWLEDGED);
    expect(prisma.pingRecipient.update).toHaveBeenCalledWith({
      where: { id: 'r1' },
      data: {
        status: PingRecipientStatus.ACKNOWLEDGED,
        acknowledgedAt: expect.any(Date),
        respondedAt: expect.any(Date),
      },
    });
  });

  it('preserves an earlier acknowledgement when resolving later', async () => {
    const acknowledgedAt = new Date('2026-08-01T10:00:00Z');
    prisma.pingRecipient.findUnique.mockResolvedValue({
      id: 'r1',
      employeeId: 'sender',
      status: PingRecipientStatus.ACKNOWLEDGED,
      acknowledgedAt,
    });
    await service.updateStatus('r1', user, PingRecipientStatus.RESOLVED);
    expect(prisma.pingRecipient.update).toHaveBeenCalledWith({
      where: { id: 'r1' },
      data: {
        status: PingRecipientStatus.RESOLVED,
        respondedAt: expect.any(Date),
      },
    });
  });

  it('lists every active employee except the sender for the global widget', async () => {
    prisma.employee.findMany.mockResolvedValue([
      {
        id: 'a',
        firstName: 'Ann',
        lastName: 'One',
        email: 'a@test.com',
        employeeId: 'EMP-A',
      },
      {
        id: 'ceo',
        firstName: 'Chief',
        lastName: 'Executive',
        email: 'ceo@test.com',
        employeeId: 'CEO-1',
      },
    ]);
    const recipients = await service.recipients(user);
    expect(prisma.employee.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { status: EmployeeStatus.ACTIVE, id: { not: 'sender' } },
      }),
    );
    expect(recipients).toEqual([
      {
        id: 'a',
        fullName: 'Ann One',
        email: 'a@test.com',
        employeeId: 'EMP-A',
      },
      {
        id: 'ceo',
        fullName: 'Chief Executive',
        email: 'ceo@test.com',
        employeeId: 'CEO-1',
      },
    ]);
  });

  it('rejects a contextual send when a recipient is outside the eligible page audience', async () => {
    jest
      .spyOn(service, 'recipients')
      .mockResolvedValueOnce([{ id: 'allowed' } as any]);
    await expect(
      service.createContextual(user, {
        message: 'Review this',
        recipientIds: ['outside'],
        linkedRecordType: 'PAGE',
        linkedRecordId: '/sales/leads',
        verticalCode: 'SALES',
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
});
