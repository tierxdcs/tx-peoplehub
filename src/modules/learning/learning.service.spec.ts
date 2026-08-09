import { ForbiddenException } from '@nestjs/common';
import { LearningCourseStatus, Role } from '@prisma/client';
import { LearningService } from './learning.service';

describe('LearningService', () => {
  const owner = {
    id: 'owner',
    email: 'owner@example.com',
    role: Role.MANAGER,
    verticalId: 'vertical-1',
  };
  let prisma: any;
  let service: LearningService;

  beforeEach(() => {
    prisma = {
      vertical: { findUnique: jest.fn() },
      learningCourse: {
        create: jest.fn(),
        findUnique: jest.fn(),
        findMany: jest.fn(),
        update: jest.fn(),
      },
      learningProgress: { upsert: jest.fn() },
    };
    service = new LearningService(prisma);
  });

  it('allows the configured vertical owner to draft a course', async () => {
    prisma.vertical.findUnique.mockResolvedValue({ ownerId: owner.id });
    prisma.learningCourse.create.mockResolvedValue({ id: 'course-1' });
    await service.create(
      {
        title: 'Sales essentials',
        summary: 'Learn the process',
        verticalId: 'vertical-1',
        content: {
          lessons: [{ key: 'one', title: 'Start', body: 'Begin here' }],
        },
      },
      owner,
    );
    expect(prisma.learningCourse.create).toHaveBeenCalled();
  });

  it('rejects a non-owner course author', async () => {
    prisma.vertical.findUnique.mockResolvedValue({ ownerId: 'different-user' });
    await expect(
      service.create(
        {
          title: 'Sales essentials',
          summary: 'Learn the process',
          verticalId: 'vertical-1',
          content: {
            lessons: [{ key: 'one', title: 'Start', body: 'Begin here' }],
          },
        },
        owner,
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('completes progress only when every lesson in the current version is done', async () => {
    prisma.learningCourse.findUnique.mockResolvedValue({
      id: 'course-1',
      version: 3,
      status: LearningCourseStatus.PUBLISHED,
      content: { lessons: [{ key: 'one' }, { key: 'two' }] },
    });
    prisma.learningProgress.upsert.mockImplementation(
      ({ create }: any) => create,
    );
    const result = await service.saveProgress(
      'course-1',
      { completedLessonKeys: ['one', 'two', 'unknown'] },
      owner,
    );
    expect(result.courseVersion).toBe(3);
    expect(result.completedLessonKeys).toEqual(['one', 'two']);
    expect(result.completedAt).toBeInstanceOf(Date);
  });
});
