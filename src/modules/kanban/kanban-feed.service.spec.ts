import { KanbanFeedService } from './kanban-feed.service';

describe('KanbanFeedService', () => {
  it('allows a card viewer to comment without structural edit permission', async () => {
    const prisma = {
      kanbanCard: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'card-1',
          title: 'SCM support',
          assigneeId: 'assignee-1',
          createdById: 'creator-1',
          list: { boardId: 'board-1' },
        }),
      },
      kanbanCardComment: {
        create: jest.fn().mockResolvedValue({
          id: 'comment-1',
          cardId: 'card-1',
          authorId: 'author-1',
          text: 'Reply',
          createdAt: new Date('2026-07-23T00:00:00.000Z'),
          author: { firstName: 'Punith', lastName: 'NS' },
        }),
      },
    };
    const access = {
      assertCanViewCard: jest.fn().mockResolvedValue({ hasBoardAccess: true }),
      assertCanEditCard: jest.fn(),
    };
    const notifications = {
      notifyCommented: jest.fn().mockResolvedValue(undefined),
    };
    const service = new KanbanFeedService(
      prisma as never,
      access as never,
      notifications as never,
    );

    await service.addComment('card-1', { text: 'Reply' }, {
      id: 'author-1',
      email: 'punith@example.com',
      role: 'EMPLOYEE',
    } as never);

    expect(access.assertCanViewCard).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'author-1' }),
      'board-1',
      'assignee-1',
    );
    expect(access.assertCanEditCard).not.toHaveBeenCalled();
    expect(prisma.kanbanCardComment.create).toHaveBeenCalled();
    // The creator is carried through as well as the assignee — they are who the
    // comment push is for, and the comment text is what it previews.
    expect(notifications.notifyCommented).toHaveBeenCalledWith({
      assigneeId: 'assignee-1',
      creatorId: 'creator-1',
      actorId: 'author-1',
      cardId: 'card-1',
      cardTitle: 'SCM support',
      comment: 'Reply',
    });
  });

  it('returns the combined feed newest-first, interleaving comments and activity', async () => {
    const prisma = {
      kanbanCard: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'card-1',
          status: 'ACTIVE',
          title: 'SCM support',
          assigneeId: 'assignee-1',
          list: { boardId: 'board-1' },
        }),
      },
      kanbanCardComment: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'comment-old',
            authorId: 'author-1',
            text: 'first ever',
            createdAt: new Date('2026-07-23T09:00:00.000Z'),
            author: { firstName: 'Punith', lastName: 'NS' },
          },
          {
            id: 'comment-new',
            authorId: 'author-1',
            text: 'latest word',
            createdAt: new Date('2026-07-23T15:00:00.000Z'),
            author: { firstName: 'Punith', lastName: 'NS' },
          },
        ]),
      },
      kanbanCardActivity: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'activity-mid',
            actorId: 'author-1',
            description: 'moved the card',
            createdAt: new Date('2026-07-23T12:00:00.000Z'),
            actor: { firstName: 'Punith', lastName: 'NS' },
          },
        ]),
      },
    };
    const access = {
      assertCanViewCard: jest.fn().mockResolvedValue({ hasBoardAccess: true }),
    };
    const service = new KanbanFeedService(
      prisma as never,
      access as never,
      {} as never,
    );

    const feed = await service.getFeed('card-1', {
      id: 'author-1',
      email: 'punith@example.com',
      role: 'EMPLOYEE',
    } as never);

    // Descending by createdAt, comments and activity interleaved by timestamp.
    expect(feed.map((i) => i.id)).toEqual([
      'comment-new',
      'activity-mid',
      'comment-old',
    ]);
  });
});
