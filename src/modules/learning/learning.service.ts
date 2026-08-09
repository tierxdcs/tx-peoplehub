import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { LearningCourseStatus, Prisma, Role } from '@prisma/client';
import { AuthenticatedUser } from '../../common/decorators/current-user.decorator';
import { PrismaService } from '../../core/database/prisma.service';
import {
  CreateLearningCourseDto,
  UpdateLearningCourseDto,
  UpdateLearningProgressDto,
} from './dto/learning.dto';

const include = {
  vertical: { select: { id: true, name: true, code: true, ownerId: true } },
  createdBy: { select: { id: true, firstName: true, lastName: true } },
} as const;

@Injectable()
export class LearningService {
  constructor(private readonly prisma: PrismaService) {}

  async list(user: AuthenticatedUser) {
    const owned =
      user.role === Role.SUPER_ADMIN
        ? undefined
        : {
            OR: [
              { status: LearningCourseStatus.PUBLISHED },
              { vertical: { ownerId: user.id } },
            ],
          };
    const rows = await this.prisma.learningCourse.findMany({
      where: {
        ...(user.role === Role.SUPER_ADMIN
          ? {}
          : { verticalId: user.verticalId ?? '__none__' }),
        ...(owned ?? {}),
      },
      include: {
        ...include,
        progress: { where: { employeeId: user.id }, take: 1 },
      },
      orderBy: [{ status: 'asc' }, { updatedAt: 'desc' }],
    });
    return rows.map((row) => ({
      ...row,
      canEdit:
        user.role === Role.SUPER_ADMIN || row.vertical.ownerId === user.id,
      progress:
        row.progress[0]?.courseVersion === row.version ? row.progress[0] : null,
    }));
  }

  async create(dto: CreateLearningCourseDto, user: AuthenticatedUser) {
    await this.assertAuthor(dto.verticalId, user);
    this.assertContent(dto.content);
    return this.prisma.learningCourse.create({
      data: {
        ...dto,
        content: dto.content as Prisma.InputJsonValue,
        createdById: user.id,
        updatedById: user.id,
      },
      include,
    });
  }

  async update(
    id: string,
    dto: UpdateLearningCourseDto,
    user: AuthenticatedUser,
  ) {
    const course = await this.require(id);
    await this.assertAuthor(course.verticalId, user);
    if (dto.content) this.assertContent(dto.content);
    return this.prisma.learningCourse.update({
      where: { id },
      data: {
        title: dto.title,
        summary: dto.summary,
        ...(dto.content
          ? { content: dto.content as Prisma.InputJsonValue }
          : {}),
        updatedById: user.id,
        version: { increment: 1 },
      },
      include,
    });
  }

  async publish(id: string, user: AuthenticatedUser) {
    const course = await this.require(id);
    await this.assertAuthor(course.verticalId, user);
    return this.prisma.learningCourse.update({
      where: { id },
      data: { status: LearningCourseStatus.PUBLISHED, updatedById: user.id },
      include,
    });
  }

  async saveProgress(
    id: string,
    dto: UpdateLearningProgressDto,
    user: AuthenticatedUser,
  ) {
    const course = await this.require(id);
    if (
      course.status !== LearningCourseStatus.PUBLISHED &&
      user.role !== Role.SUPER_ADMIN
    )
      throw new ForbiddenException('This course is not published');
    const lessons = this.lessonKeys(course.content);
    const completedLessonKeys = [...new Set(dto.completedLessonKeys)].filter(
      (key) => lessons.includes(key),
    );
    const completedAt =
      lessons.length > 0 && completedLessonKeys.length === lessons.length
        ? new Date()
        : null;
    return this.prisma.learningProgress.upsert({
      where: { courseId_employeeId: { courseId: id, employeeId: user.id } },
      create: {
        courseId: id,
        employeeId: user.id,
        courseVersion: course.version,
        completedLessonKeys,
        completedAt,
      },
      update: {
        courseVersion: course.version,
        completedLessonKeys,
        completedAt,
      },
    });
  }

  private async assertAuthor(verticalId: string, user: AuthenticatedUser) {
    if (user.role === Role.SUPER_ADMIN) return;
    const vertical = await this.prisma.vertical.findUnique({
      where: { id: verticalId },
      select: { ownerId: true },
    });
    if (!vertical || vertical.ownerId !== user.id)
      throw new ForbiddenException(
        'Only this process owner or the CEO may author its courses',
      );
  }

  private async require(id: string) {
    const course = await this.prisma.learningCourse.findUnique({
      where: { id },
    });
    if (!course) throw new NotFoundException('Learning course not found');
    return course;
  }

  private assertContent(content: Record<string, unknown>) {
    const lessons = (content as { lessons?: unknown }).lessons;
    if (!Array.isArray(lessons) || lessons.length === 0)
      throw new BadRequestException('A course requires at least one lesson');
    for (const lesson of lessons) {
      const value = lesson as {
        key?: unknown;
        title?: unknown;
        body?: unknown;
      };
      if (
        typeof value.key !== 'string' ||
        typeof value.title !== 'string' ||
        typeof value.body !== 'string'
      )
        throw new BadRequestException(
          'Every lesson requires a key, title and explanation',
        );
    }
  }

  private lessonKeys(content: Prisma.JsonValue): string[] {
    if (!content || Array.isArray(content) || typeof content !== 'object')
      return [];
    const lessons = (content as { lessons?: unknown }).lessons;
    return Array.isArray(lessons)
      ? lessons
          .map((lesson) => (lesson as { key?: string }).key)
          .filter((key): key is string => !!key)
      : [];
  }
}
