import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { KanbanCardStatus, KanbanSprintDuration } from '@prisma/client';
import { PrismaService } from '../../core/database/prisma.service';
import { AuthenticatedUser } from '../../common/decorators/current-user.decorator';
import { KanbanAccessService } from './kanban-access.service';
import {
  CreateListDto,
  CreateSprintDto,
  ReorderListDto,
  UpdateListDto,
} from './dto/kanban.dto';
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

/** Same fractional-ordering scheme as cards (see KanbanCardsService). */
const MIN_POSITION_GAP = 1e-6;
const POSITION_STEP = 1024;

@Injectable()
export class KanbanListsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: KanbanAccessService,
  ) {}

  // ── Lists ──────────────────────────────────────────────────────────

  /** Any board member may VIEW the lists (each with its ACTIVE-card count). */
  async listLists(
    boardId: string,
    user: AuthenticatedUser,
  ): Promise<KanbanListEntity[]> {
    await this.access.assertCanViewBoard(user, boardId);
    const lists = await this.prisma.kanbanList.findMany({
      where: { boardId },
      orderBy: { position: 'asc' },
      include: {
        _count: {
          select: { cards: { where: { status: KanbanCardStatus.ACTIVE } } },
        },
      },
    });
    return lists.map((l) => this.toListEntity(l, l._count.cards));
  }

  /** Create a list — Scrum Master / SUPER_ADMIN (and a member of the board). */
  async createList(
    boardId: string,
    dto: CreateListDto,
    user: AuthenticatedUser,
  ): Promise<KanbanListEntity> {
    await this.access.assertCanManageBoard(user, boardId);
    const list = await this.prisma.$transaction(async (tx) => {
      if (dto.isDoneList) {
        await tx.kanbanList.updateMany({
          where: { boardId, isDoneList: true },
          data: { isDoneList: false },
        });
      }
      return tx.kanbanList.create({
        data: {
          boardId,
          name: dto.name,
          position: dto.position,
          isDoneList: dto.isDoneList ?? false,
          createdById: user.id,
        },
      });
    });
    return this.toListEntity(list, 0);
  }

  /** Edit a list's name / done-flag — Scrum Master / SUPER_ADMIN. */
  async updateList(
    id: string,
    dto: UpdateListDto,
    user: AuthenticatedUser,
  ): Promise<KanbanListEntity> {
    const list = await this.getListOrThrow(id);
    await this.access.assertCanManageBoard(user, list.boardId);
    if (list.isDoneList && dto.isDoneList === false)
      throw new BadRequestException(
        'A board must always have one done list. Designate another list as done first.',
      );
    const updated = await this.prisma.$transaction(async (tx) => {
      if (dto.isDoneList === true) {
        await tx.kanbanList.updateMany({
          where: { boardId: list.boardId, isDoneList: true, id: { not: id } },
          data: { isDoneList: false },
        });
      }
      return tx.kanbanList.update({
        where: { id },
        data: {
          ...(dto.name !== undefined ? { name: dto.name } : {}),
          ...(dto.isDoneList !== undefined
            ? { isDoneList: dto.isDoneList }
            : {}),
        },
        include: {
          _count: {
            select: { cards: { where: { status: KanbanCardStatus.ACTIVE } } },
          },
        },
      });
    });
    return this.toListEntity(updated, updated._count.cards);
  }

  /** Delete an empty, non-done list. The board's sole done list is protected. */
  async deleteList(id: string, user: AuthenticatedUser): Promise<void> {
    const list = await this.getListOrThrow(id);
    await this.access.assertCanManageBoard(user, list.boardId);
    if (list.isDoneList)
      throw new BadRequestException(
        'The board done list cannot be deleted. Designate another list as done first.',
      );
    const activeCards = await this.prisma.kanbanCard.count({
      where: { listId: id, status: KanbanCardStatus.ACTIVE },
    });
    if (activeCards)
      throw new BadRequestException(
        'Move all active cards before deleting this list.',
      );
    await this.prisma.kanbanList.delete({ where: { id } });
  }

  /**
   * Reorder a list within its board — Scrum Master / SUPER_ADMIN. Same
   * fractional scheme as card moves: the client passes the midpoint between
   * neighbours; we re-space only when the requested slot collides too tightly.
   */
  async reorderList(
    id: string,
    dto: ReorderListDto,
    user: AuthenticatedUser,
  ): Promise<KanbanListEntity> {
    const list = await this.getListOrThrow(id);
    await this.access.assertCanManageBoard(user, list.boardId);

    let position = dto.position;
    const tooTight = await this.prisma.kanbanList.findFirst({
      where: {
        boardId: list.boardId,
        id: { not: id },
        position: {
          gt: position - MIN_POSITION_GAP,
          lt: position + MIN_POSITION_GAP,
        },
      },
      select: { id: true },
    });
    if (tooTight) {
      await this.respaceLists(list.boardId, id);
      const last = await this.prisma.kanbanList.findFirst({
        where: { boardId: list.boardId, id: { not: id } },
        orderBy: { position: 'desc' },
        select: { position: true },
      });
      position = (last?.position ?? 0) + POSITION_STEP;
    }

    const updated = await this.prisma.kanbanList.update({
      where: { id },
      data: { position },
      include: {
        _count: {
          select: { cards: { where: { status: KanbanCardStatus.ACTIVE } } },
        },
      },
    });
    return this.toListEntity(updated, updated._count.cards);
  }

  private async getListOrThrow(
    id: string,
  ): Promise<{ id: string; boardId: string; isDoneList: boolean }> {
    const list = await this.prisma.kanbanList.findUnique({
      where: { id },
      select: { id: true, boardId: true, isDoneList: true },
    });
    if (!list) throw new NotFoundException('List not found');
    return list;
  }

  /** Re-space a board's lists to integer steps (rare precision reset). */
  private async respaceLists(
    boardId: string,
    excludeId: string,
  ): Promise<void> {
    const lists = await this.prisma.kanbanList.findMany({
      where: { boardId, id: { not: excludeId } },
      orderBy: { position: 'asc' },
      select: { id: true },
    });
    await this.prisma.$transaction(
      lists.map((l, i) =>
        this.prisma.kanbanList.update({
          where: { id: l.id },
          data: { position: (i + 1) * POSITION_STEP },
        }),
      ),
    );
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
      include: {
        _count: {
          select: { cards: { where: { status: KanbanCardStatus.ACTIVE } } },
        },
      },
    });
    return sprints.map((s) => this.toSprintEntity(s, s._count.cards));
  }

  /**
   * Sprints across every board the caller can view (optionally one board),
   * grouped by computed status, each with an ACTIVE-card count. Membership is
   * enforced by restricting to viewableBoardIds; an explicit boardId is
   * intersected with that set (so a non-member gets an empty result, not 403).
   */
  async listAllSprints(
    user: AuthenticatedUser,
    boardId?: string,
  ): Promise<Record<KanbanSprintStatus, KanbanSprintEntity[]>> {
    let boardIds = await this.access.viewableBoardIds(user);
    if (boardId) {
      boardIds = boardIds.filter((id) => id === boardId);
    }
    const grouped: Record<KanbanSprintStatus, KanbanSprintEntity[]> = {
      UPCOMING: [],
      ACTIVE: [],
      COMPLETED: [],
    };
    if (boardIds.length === 0) return grouped;

    const sprints = await this.prisma.kanbanSprint.findMany({
      where: { boardId: { in: boardIds } },
      orderBy: { startDate: 'asc' },
      include: {
        _count: {
          select: { cards: { where: { status: KanbanCardStatus.ACTIVE } } },
        },
      },
    });
    for (const s of sprints) {
      const entity = this.toSprintEntity(s, s._count.cards);
      grouped[entity.status].push(entity);
    }
    return grouped;
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
    return this.toSprintEntity(sprint, 0);
  }

  // ── mappers ────────────────────────────────────────────────────────

  private toListEntity(
    l: {
      id: string;
      boardId: string;
      name: string;
      position: number;
      isDoneList: boolean;
      createdById: string;
      createdAt: Date;
      updatedAt: Date;
    },
    cardCount: number,
  ): KanbanListEntity {
    return new KanbanListEntity({
      id: l.id,
      boardId: l.boardId,
      name: l.name,
      position: l.position,
      isDoneList: l.isDoneList,
      cardCount,
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

  private toSprintEntity(
    s: {
      id: string;
      boardId: string;
      name: string;
      durationWeeks: KanbanSprintDuration;
      startDate: Date;
      endDate: Date;
      createdById: string;
      createdAt: Date;
      updatedAt: Date;
    },
    cardCount: number,
  ): KanbanSprintEntity {
    return new KanbanSprintEntity({
      id: s.id,
      boardId: s.boardId,
      name: s.name,
      durationWeeks: s.durationWeeks,
      startDate: s.startDate.toISOString(),
      endDate: s.endDate.toISOString(),
      status: this.sprintStatus(s.startDate, s.endDate),
      cardCount,
      createdById: s.createdById,
      createdAt: s.createdAt.toISOString(),
      updatedAt: s.updatedAt.toISOString(),
    });
  }
}
