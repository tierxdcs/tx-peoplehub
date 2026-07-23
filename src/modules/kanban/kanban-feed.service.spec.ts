import { KanbanFeedService } from './kanban-feed.service';

describe('KanbanFeedService', () => {
  it('allows a card viewer to comment without structural edit permission', async () => {
    const prisma = {
      kanbanCard: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'card-1',
          title: 'SCM support',
          assigneeId: 'assignee-1',
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
      assertCanViewCard: jest
        .fn()
        .mockResolvedValue({ hasBoardAccess: true }),
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

    await service.addComment(
      'card-1',
      { text: 'Reply' },
      {
        id: 'author-1',
        email: 'punith@example.com',
        role: 'EMPLOYEE',
      } as never,
    );

    expect(access.assertCanViewCard).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'author-1' }),
      'board-1',
      'assignee-1',
    );
    expect(access.assertCanEditCard).not.toHaveBeenCalled();
    expect(prisma.kanbanCardComment.create).toHaveBeenCalled();
  });
});
