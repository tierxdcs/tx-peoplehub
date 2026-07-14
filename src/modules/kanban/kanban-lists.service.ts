import { Injectable } from '@nestjs/common';
import { KanbanSprintDuration } from '@prisma/client';
import { PrismaService } from '../../core/database/prisma.service';
import { AuthenticatedUser } from '../../common/decorators/current-user.decorator';
import { KanbanAccessService } from './kanban-access.service';
import { CreateListDto, CreateSprintDto } from './dto/kanban.dto';
import {
  KanbanListEntity,
  KanbanSprintEntity,
  KanbanSprintStatus,
} from './entities/kanban.entity';

/** Weeks per KanbanSprintDuration enum value. */
const DURATION_WEEKS: Record<KanbanSprintDuration, number> = {
  ONE_WEEK: 1,
  TWO_WEEKS: 2,
  THREE_WEEKS: 3,
  FOUR_WEEKS: 4,
};

@Injectable()
export class KanbanListsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: KanbanAccessService,
  ) {}

  // ── Lists ──────────────────────────────────────────────────────────

  /** Any board member may VIEW the lists. */
  async listLists(
    boardId: string,
    user: AuthenticatedUser,
  ): Promise<KanbanListEntity[]> {
    await this.access.assertCanViewBoard(user, boardId);
    const lists = await this.prisma.kanbanList.findMany({
      where: { boardId },
      orderBy: { position: 'asc' },
    });
    return lists.map((l) => this.toListEntity(l));
  }

  /** Create a list — Scrum Master / SUPER_ADMIN (and a member of the board). */
  async createList(
    boardId: string,
    dto: CreateListDto,
    user: AuthenticatedUser,
  ): Promise<KanbanListEntity> {
    await this.access.assertCanManageBoard(user, boardId);
    const list = await this.prisma.kanbanList.create({
      data: {
        boardId,
        name: dto.name,
        position: dto.position,
        createdById: user.id,
      },
    });
    return this.toListEntity(list);
  }

  // ── Sprints ────────────────────────────────────────────────────────

  async listSprints(
    boardId: string,
    user: AuthenticatedUser,
  ): Promise<KanbanSprintEntity[]> {
    await this.access.assertCanViewBoard(user, boardId);
    const sprints = await this.prisma.kanbanSprint.findMany({
      where: { boardId },
      orderBy: { startDate: 'asc' },
    });
    return sprints.map((s) => this.toSprintEntity(s));
  }

  /**
   * Create a sprint — Scrum Master / SUPER_ADMIN. endDate is computed once from
   * startDate + durationWeeks*7d and stored (not recomputed live). Status stays
   * computed at read time.
   */
  async createSprint(
    boardId: string,
    dto: CreateSprintDto,
    user: AuthenticatedUser,
  ): Promise<KanbanSprintEntity> {
    await this.access.assertCanManageBoard(user, boardId);
    const startDate = new Date(dto.startDate);
    const endDate = new Date(startDate);
    endDate.setUTCDate(
      endDate.getUTCDate() + DURATION_WEEKS[dto.durationWeeks] * 7,
    );
    const sprint = await this.prisma.kanbanSprint.create({
      data: {
        boardId,
        name: dto.name,
        durationWeeks: dto.durationWeeks,
        startDate,
        endDate,
        createdById: user.id,
      },
    });
    return this.toSprintEntity(sprint);
  }

  // ── mappers ────────────────────────────────────────────────────────

  private toListEntity(l: {
    id: string;
    boardId: string;
    name: string;
    position: number;
    createdById: string;
    createdAt: Date;
    updatedAt: Date;
  }): KanbanListEntity {
    return new KanbanListEntity({
      id: l.id,
      boardId: l.boardId,
      name: l.name,
      position: l.position,
      createdById: l.createdById,
      createdAt: l.createdAt.toISOString(),
      updatedAt: l.updatedAt.toISOString(),
    });
  }

  /** Compute sprint status from its date window relative to now. */
  private sprintStatus(startDate: Date, endDate: Date): KanbanSprintStatus {
    const now = Date.now();
    if (now < startDate.getTime()) return 'UPCOMING';
    if (now > endDate.getTime()) return 'COMPLETED';
    return 'ACTIVE';
  }

  private toSprintEntity(s: {
    id: string;
    boardId: string;
    name: string;
    durationWeeks: KanbanSprintDuration;
    startDate: Date;
    endDate: Date;
    createdById: string;
    createdAt: Date;
    updatedAt: Date;
  }): KanbanSprintEntity {
    return new KanbanSprintEntity({
      id: s.id,
      boardId: s.boardId,
      name: s.name,
      durationWeeks: s.durationWeeks,
      startDate: s.startDate.toISOString(),
      endDate: s.endDate.toISOString(),
      status: this.sprintStatus(s.startDate, s.endDate),
      createdById: s.createdById,
      createdAt: s.createdAt.toISOString(),
      updatedAt: s.updatedAt.toISOString(),
    });
  }
}
