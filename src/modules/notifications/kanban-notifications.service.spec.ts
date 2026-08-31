import { NotificationType } from '@prisma/client';
import { KanbanNotificationsService } from './kanban-notifications.service';

/**
 * The push is fired without being awaited, so the request is never held up by a
 * push service. That means a test has to let the microtask queue drain before
 * asserting on it — which is also a small proof that the send really is off the
 * caller's critical path.
 */
const flush = () => new Promise((resolve) => setImmediate(resolve));

describe('KanbanNotificationsService — push on assignment', () => {
  const prisma = {
    notification: { create: jest.fn() },
    employee: { findUnique: jest.fn() },
  } as any;
  const push = { trySendToEmployee: jest.fn().mockResolvedValue(null) } as any;
  const service = new KanbanNotificationsService(prisma, push);

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.employee.findUnique.mockResolvedValue({
      firstName: 'Ravi',
      lastName: 'Kumar',
    });
  });

  it('pushes the assigner name and task title to the new assignee', async () => {
    await service.notifyAssigned({
      assigneeId: 'emp-2',
      actorId: 'emp-1',
      cardId: 'card-7',
      cardTitle: 'Draft the Q3 vendor audit plan',
    });
    await flush();

    expect(prisma.notification.create).toHaveBeenCalledWith({
      data: {
        employeeId: 'emp-2',
        type: NotificationType.CARD_ASSIGNED,
        relatedCardId: 'card-7',
        message: 'You were assigned to "Draft the Q3 vendor audit plan"',
      },
    });
    expect(push.trySendToEmployee).toHaveBeenCalledWith(
      'emp-2',
      expect.objectContaining({
        title: 'Ravi Kumar assigned you a task',
        body: 'Draft the Q3 vendor audit plan',
        url: '/kanban/cards/card-7',
      }),
      'card assigned',
    );
  });

  it('does not push when someone assigns a card to themselves', async () => {
    await service.notifyAssigned({
      assigneeId: 'emp-1',
      actorId: 'emp-1',
      cardId: 'card-7',
      cardTitle: 'Mine',
    });
    await flush();

    expect(prisma.notification.create).not.toHaveBeenCalled();
    expect(push.trySendToEmployee).not.toHaveBeenCalled();
  });

  it('does not push when a card is unassigned (no recipient)', async () => {
    await service.notifyAssigned({
      assigneeId: null,
      actorId: 'emp-1',
      cardId: 'card-7',
      cardTitle: 'Nobody',
    });
    await flush();

    expect(push.trySendToEmployee).not.toHaveBeenCalled();
  });

  it('sends the in-app notification but no push for comments and updates', async () => {
    // Scope guard: CARD_ASSIGNED is the only card event that reaches a phone.
    await service.notifyCommented({
      assigneeId: 'emp-2',
      actorId: 'emp-1',
      cardId: 'card-7',
      cardTitle: 'Task',
    });
    await service.notifyUpdated({
      assigneeId: 'emp-2',
      actorId: 'emp-1',
      cardId: 'card-7',
      summary: '"Task" was updated',
    });
    await flush();

    expect(prisma.notification.create).toHaveBeenCalledTimes(2);
    expect(push.trySendToEmployee).not.toHaveBeenCalled();
  });

  it('still records the assignment when the push send blows up', async () => {
    push.trySendToEmployee.mockRejectedValueOnce(new Error('no VAPID keys'));
    await expect(
      service.notifyAssigned({
        assigneeId: 'emp-2',
        actorId: 'emp-1',
        cardId: 'card-7',
        cardTitle: 'Task',
      }),
    ).resolves.toBeUndefined();
    await flush();

    expect(prisma.notification.create).toHaveBeenCalledTimes(1);
  });

  it('falls back to a generic assigner rather than dropping the push', async () => {
    prisma.employee.findUnique.mockResolvedValueOnce(null);
    await service.notifyAssigned({
      assigneeId: 'emp-2',
      actorId: 'ghost',
      cardId: 'card-7',
      cardTitle: 'Task',
    });
    await flush();

    expect(push.trySendToEmployee).toHaveBeenCalledWith(
      'emp-2',
      expect.objectContaining({ title: 'Someone assigned you a task' }),
      'card assigned',
    );
  });

  it('does not let a failed assigner lookup escape as an unhandled rejection', async () => {
    prisma.employee.findUnique.mockRejectedValueOnce(new Error('db down'));
    await service.notifyAssigned({
      assigneeId: 'emp-2',
      actorId: 'emp-1',
      cardId: 'card-7',
      cardTitle: 'Task',
    });
    await flush();

    expect(push.trySendToEmployee).not.toHaveBeenCalled();
    expect(prisma.notification.create).toHaveBeenCalledTimes(1);
  });
});
