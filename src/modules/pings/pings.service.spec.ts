import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { PingRecipientStatus, Role } from '@prisma/client';
import { PingsService } from './pings.service';

describe('PingsService', () => {
  const prisma = {
    employee: { count: jest.fn(), findUnique: jest.fn(), findMany: jest.fn() },
    vertical: { findUnique: jest.fn() },
    kanbanBoard: { findUnique: jest.fn() },
    ping: { create: jest.fn(), findMany: jest.fn() },
    pingRecipient: { findMany: jest.fn(), findUnique: jest.fn(), update: jest.fn() },
  } as any;
  const service = new PingsService(prisma);
  const user = { id: 'sender', email: 'sender@test.com', role: Role.EMPLOYEE, verticalId: null };

  beforeEach(() => jest.clearAllMocks());

  it('creates one recipient state per unique active employee', async () => {
    prisma.employee.count.mockResolvedValue(2);
    prisma.ping.create.mockResolvedValue({ id: 'ping-1', fromEmployee: { id: 'sender', firstName: 'Send', lastName: 'Er', email: 'sender@test.com', employeeId: 'EMP-1' }, recipients: [] });
    await service.create(user, { message: 'Please check', recipientIds: ['a', 'b', 'a'] });
    expect(prisma.ping.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ recipients: { create: [{ employeeId: 'a' }, { employeeId: 'b' }] } }) }));
  });

  it('does not allow a ping addressed only to its sender', async () => {
    await expect(service.create(user, { message: 'Self', recipientIds: ['sender'] })).rejects.toBeInstanceOf(BadRequestException);
  });

  it('prevents one recipient from responding for another', async () => {
    prisma.pingRecipient.findUnique.mockResolvedValue({ id: 'r1', employeeId: 'someone-else', status: PingRecipientStatus.PENDING });
    await expect(service.updateStatus('r1', user, PingRecipientStatus.ACKNOWLEDGED)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('records acknowledgement time without changing other recipients', async () => {
    prisma.pingRecipient.findUnique.mockResolvedValue({ id: 'r1', employeeId: 'sender', status: PingRecipientStatus.PENDING });
    prisma.pingRecipient.update.mockResolvedValue({ id: 'r1', status: PingRecipientStatus.ACKNOWLEDGED });
    await service.updateStatus('r1', user, PingRecipientStatus.ACKNOWLEDGED);
    expect(prisma.pingRecipient.update).toHaveBeenCalledWith({ where: { id: 'r1' }, data: { status: PingRecipientStatus.ACKNOWLEDGED, respondedAt: expect.any(Date) } });
  });

  it('enforces the current page vertical for regular users', async () => {
    prisma.employee.findUnique.mockResolvedValue({ verticalId: 'sales-id' });
    prisma.vertical.findUnique.mockResolvedValue({ id: 'scm-id' });
    await expect(service.recipients(user, 'SCM', 'PAGE', '/scm/items')).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('scopes a regular recipient list to the caller vertical', async () => {
    prisma.employee.findUnique.mockResolvedValue({ verticalId: 'sales-id' });
    prisma.vertical.findUnique.mockResolvedValue({ id: 'sales-id' });
    prisma.employee.findMany.mockResolvedValue([]);
    await service.recipients(user, 'SALES', 'PAGE', '/sales/leads');
    expect(prisma.employee.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ verticalId: 'sales-id' }) }));
  });

  it('rejects a contextual send when a recipient is outside the eligible page audience', async () => {
    jest.spyOn(service, 'recipients').mockResolvedValueOnce([{ id: 'allowed' } as any]);
    await expect(service.createContextual(user, { message: 'Review this', recipientIds: ['outside'], linkedRecordType: 'PAGE', linkedRecordId: '/sales/leads', verticalCode: 'SALES' })).rejects.toBeInstanceOf(ForbiddenException);
  });
});
