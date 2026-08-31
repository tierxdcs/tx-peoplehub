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

  it('sends the in-app notification but no push for a card edit', async () => {
    // Scope guard: a field changing is still in-app only. Assignment and a comment
    // on a card you created are the only two card events that reach a phone.
    await service.notifyUpdated({
      assigneeId: 'emp-2',
      actorId: 'emp-1',
      cardId: 'card-7',
      summary: '"Task" was updated',
    });
    await flush();

    expect(prisma.notification.create).toHaveBeenCalledTimes(1);
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

describe('KanbanNotificationsService — push on comment', () => {
  const prisma = {
    notification: { create: jest.fn() },
    employee: { findUnique: jest.fn() },
  } as any;
  const push = { trySendToEmployee: jest.fn().mockResolvedValue(null) } as any;
  const service = new KanbanNotificationsService(prisma, push);

  /** A comment by emp-3 on card-7, created by emp-1 and assigned to emp-2. */
  const comment = {
    assigneeId: 'emp-2',
    creatorId: 'emp-1',
    actorId: 'emp-3',
    cardId: 'card-7',
    cardTitle: 'Draft the Q3 vendor audit plan',
    comment: 'Blocked on the vendor list — can you confirm the shortlist?',
  };

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.employee.findUnique.mockResolvedValue({
      firstName: 'Asha',
      lastName: 'Menon',
    });
  });

  it('tells the assignee and the creator, and pushes only the creator', async () => {
    await service.notifyCommented(comment);
    await flush();

    const recipients = prisma.notification.create.mock.calls.map(
      (c: any[]) => c[0].data.employeeId,
    );
    expect(recipients).toEqual(['emp-2', 'emp-1']);
    // The assignee is working the card and sees the thread; the creator has no
    // other reason to look, which is what earns the phone buzz.
    expect(push.trySendToEmployee).toHaveBeenCalledTimes(1);
    expect(push.trySendToEmployee).toHaveBeenCalledWith(
      'emp-1',
      expect.objectContaining({
        title: 'Asha Menon commented on your card',
        body: 'Draft the Q3 vendor audit plan — Blocked on the vendor list — can you confirm the shortlist?',
        url: '/kanban/cards/card-7',
        tag: 'card-comment:card-7',
      }),
      'card commented',
    );
  });

  it('writes one bell row, and still pushes, when the creator kept the card', async () => {
    await service.notifyCommented({
      ...comment,
      assigneeId: 'emp-1',
      creatorId: 'emp-1',
    });
    await flush();

    // One person, one row — but they are still the creator, so the push stands.
    expect(prisma.notification.create).toHaveBeenCalledTimes(1);
    expect(push.trySendToEmployee).toHaveBeenCalledWith(
      'emp-1',
      expect.anything(),
      'card commented',
    );
  });

  it('says nothing to the creator about their own comment', async () => {
    await service.notifyCommented({ ...comment, actorId: 'emp-1' });
    await flush();

    // The assignee is still told; the creator commented, so they are not.
    expect(prisma.notification.create).toHaveBeenCalledTimes(1);
    expect(prisma.notification.create.mock.calls[0][0].data.employeeId).toBe(
      'emp-2',
    );
    expect(push.trySendToEmployee).not.toHaveBeenCalled();
  });

  it('pushes the creator even on an unassigned card', async () => {
    await service.notifyCommented({ ...comment, assigneeId: null });
    await flush();

    expect(prisma.notification.create).toHaveBeenCalledTimes(1);
    expect(push.trySendToEmployee).toHaveBeenCalledTimes(1);
  });

  it('truncates a long comment rather than filling the shade', async () => {
    await service.notifyCommented({ ...comment, comment: 'x'.repeat(500) });
    await flush();

    expect(push.trySendToEmployee.mock.calls[0][1].body).toHaveLength(140);
  });

  it('falls back to a generic commenter rather than dropping the push', async () => {
    prisma.employee.findUnique.mockResolvedValueOnce(null);
    await service.notifyCommented({ ...comment, actorId: 'ghost' });
    await flush();

    expect(push.trySendToEmployee).toHaveBeenCalledWith(
      'emp-1',
      expect.objectContaining({ title: 'Someone commented on your card' }),
      'card commented',
    );
  });

  it('still records the comment notifications when the push blows up', async () => {
    push.trySendToEmployee.mockRejectedValueOnce(new Error('no VAPID keys'));
    await expect(service.notifyCommented(comment)).resolves.toBeUndefined();
    await flush();

    expect(prisma.notification.create).toHaveBeenCalledTimes(2);
  });
});
