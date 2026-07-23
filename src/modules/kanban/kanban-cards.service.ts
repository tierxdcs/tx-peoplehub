import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { KanbanCard, KanbanCardStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../../core/database/prisma.service';
import { AuthenticatedUser } from '../../common/decorators/current-user.decorator';
import { KanbanAccessService } from './kanban-access.service';
import { KanbanActivityService } from './kanban-activity.service';
import { KanbanNotificationsService } from '../notifications/kanban-notifications.service';
import {
  CardFilterQueryDto,
  CreateCardDto,
  MoveCardDto,
  SetCardSprintDto,
  UpdateCardDto,
} from './dto/kanban.dto';
import {
  BoardVerticalProgressEntity,
  KanbanCardEntity,
  MyCardEntity,
} from './entities/kanban.entity';

/**
 * Smallest gap between two adjacent fractional positions before we bother
 * re-spacing a list. Well above float epsilon so we never actually run out of
 * precision, but we still handle the case deterministically.
 */
const MIN_POSITION_GAP = 1e-6;
/** Spacing used when appending / re-spacing (integers, leaving room between). */
const POSITION_STEP = 1024;

/**
 * Shared include for card reads/writes so every KanbanCardEntity carries the
 * assignee name, the list's done-flag (for isOverdue), and attached labels.
 */
const CARD_INCLUDE = {
  assignee: { select: { firstName: true, lastName: true } },
  vertical: { select: { name: true, code: true } },
  list: { select: { boardId: true, isDoneList: true } },
  labels: { include: { label: true } },
  sprint: { select: { name: true } },
} as const;

type CardWithList = KanbanCard & { list: { boardId: string } };

@Injectable()
export class KanbanCardsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: KanbanAccessService,
    private readonly activity: KanbanActivityService,
    private readonly notifications: KanbanNotificationsService,
  ) {}

  /** ACTIVE cards in a list, ordered by position (any board member). */
  async listCards(
    listId: string,
    user: AuthenticatedUser,
  ): Promise<KanbanCardEntity[]> {
    const list = await this.getListOrThrow(listId);
    await this.access.assertCanViewBoard(user, list.boardId);
    const cards = await this.prisma.kanbanCard.findMany({
      where: { listId, status: KanbanCardStatus.ACTIVE },
      include: CARD_INCLUDE,
      orderBy: { position: 'asc' },
    });
    return cards.map((c) => this.toEntity(c));
  }

  /**
   * A single card by id — a board member, OR (card-only access) the card's
   * own assignee. Carries boardId + listId so a deep-link (e.g. from a
   * notification) can resolve the board and open the card in context, and
   * `viewerHasBoardAccess` so the frontend can tell a full board member from
   * a card-only assignee (who gets a standalone view, no board chrome, and
   * loses board-scoped actions like "Mark complete"). 404 for a missing/
   * archived card, 403 for someone with neither board access nor assignment.
   */
  async findOne(
    id: string,
    user: AuthenticatedUser,
  ): Promise<KanbanCardEntity> {
    const card = await this.prisma.kanbanCard.findUnique({
      where: { id },
      include: CARD_INCLUDE,
    });
    if (!card || card.status === KanbanCardStatus.ARCHIVED) {
      throw new NotFoundException('Card not found');
    }
    const { hasBoardAccess } = await this.access.assertCanViewCard(
      user,
      card.list.boardId,
      card.assigneeId,
    );
    return this.toEntity(card, hasBoardAccess);
  }

  /**
   * Board-wide ACTIVE-card search — any board member. All filters optional and
   * combined with AND. `sprintId='none'` matches cards with no sprint.
   */
  async listBoardCards(
    boardId: string,
    query: CardFilterQueryDto,
    user: AuthenticatedUser,
  ): Promise<KanbanCardEntity[]> {
    await this.access.assertCanViewBoard(user, boardId);

    const where: Prisma.KanbanCardWhereInput = {
      status: KanbanCardStatus.ACTIVE,
      list: { boardId },
    };

    if (query.dueBefore || query.dueAfter) {
      where.dueDate = {
        ...(query.dueAfter ? { gte: new Date(query.dueAfter) } : {}),
        ...(query.dueBefore ? { lte: new Date(query.dueBefore) } : {}),
      };
    }
    if (query.createdBy) where.createdById = query.createdBy;
    if (query.assigneeId) where.assigneeId = query.assigneeId;
    if (query.priority) where.priority = query.priority;
    if (query.sprintId !== undefined) {
      where.sprintId = query.sprintId === 'none' ? null : query.sprintId;
    }

    const cards = await this.prisma.kanbanCard.findMany({
      where,
      include: CARD_INCLUDE,
      orderBy: [{ listId: 'asc' }, { position: 'asc' }],
    });
    return cards.map((c) => this.toEntity(c));
  }

  /**
   * Per-vertical completion for a board (any board member). Groups the board's
   * ACTIVE cards by their vertical tag and, within each, counts how many sit in
   * a done-type list. Untagged cards fall under a `verticalId: null` row. This
   * is the real-state signal behind cross-department progress on a project board
   * (e.g. "Production 2/7 done") — see ORDER_TRACKING.md.
   */
  async boardVerticalProgress(
    boardId: string,
    user: AuthenticatedUser,
  ): Promise<BoardVerticalProgressEntity[]> {
    await this.access.assertCanViewBoard(user, boardId);
    const cards = await this.prisma.kanbanCard.findMany({
      where: { status: KanbanCardStatus.ACTIVE, list: { boardId } },
      select: {
        verticalId: true,
        vertical: { select: { name: true, code: true } },
        list: { select: { isDoneList: true } },
      },
    });

    // Group by verticalId (null bucket keyed by the empty string internally).
    const buckets = new Map<string, BoardVerticalProgressEntity>();
    for (const c of cards) {
      const key = c.verticalId ?? '';
      let bucket = buckets.get(key);
      if (!bucket) {
        bucket = new BoardVerticalProgressEntity({
          verticalId: c.verticalId,
          verticalName: c.vertical?.name ?? null,
          verticalCode: c.vertical?.code ?? null,
          total: 0,
          done: 0,
        });
        buckets.set(key, bucket);
      }
      bucket.total += 1;
      if (c.list.isDoneList) bucket.done += 1;
    }

    // Tagged verticals first (alpha by code), untagged bucket last.
    return [...buckets.values()].sort((a, b) => {
      if (a.verticalId === null) return 1;
      if (b.verticalId === null) return -1;
      return (a.verticalCode ?? '').localeCompare(b.verticalCode ?? '');
    });
  }

  /**
   * Every ACTIVE card assigned to the current user, across ALL boards — the
   * personal-dashboard feed. No board-id needed and no membership check:
   * filtering by assigneeId alone is self-scoping — you're always allowed to
   * see cards assigned to YOU, board member or not (card-only access covers
   * the non-member case when they open one). Returns a flattened shape
   * carrying board context + done/overdue flags so the dashboard can compute
   * all four stat cards client-side.
   */
  async myCards(user: AuthenticatedUser): Promise<MyCardEntity[]> {
    const cards = await this.prisma.kanbanCard.findMany({
      where: { status: KanbanCardStatus.ACTIVE, assigneeId: user.id },
      include: {
        list: {
          select: {
            isDoneList: true,
            board: { select: { id: true, name: true } },
          },
        },
      },
      orderBy: [{ dueDate: 'asc' }],
    });
    const now = Date.now();
    return cards.map((c) => {
      const isDone = c.list.isDoneList;
      return new MyCardEntity({
        id: c.id,
        title: c.title,
        boardId: c.list.board.id,
        boardName: c.list.board.name,
        dueDate: c.dueDate ? c.dueDate.toISOString() : null,
        isDone,
        isOverdue: !!c.dueDate && c.dueDate.getTime() < now && !isDone,
      });
    });
  }

  /**
   * Create a card in a list — any board member. sprintId is NOT settable.
   * The assignee need not be a board member — assignment itself grants them
   * restricted "card-only" access to this one card (see assertCanViewCard).
   */
  async create(
    listId: string,
    dto: CreateCardDto,
    user: AuthenticatedUser,
  ): Promise<KanbanCardEntity> {
    const list = await this.getListOrThrow(listId);
    await this.access.assertCanViewBoard(user, list.boardId);
    const canManageBoard = await this.access
      .assertCanManageBoard(user, list.boardId)
      .then(() => true)
      .catch(() => false);
    const assigneeId = canManageBoard ? (dto.assigneeId ?? null) : user.id;
    if (!canManageBoard && dto.assigneeId && dto.assigneeId !== user.id) {
      throw new ForbiddenException(
        'You may only create cards assigned to yourself',
      );
    }
    if (assigneeId) {
      await this.access.assertAssigneeExists(assigneeId);
    }
    if (dto.plmTrackerId) {
      const tracker = await this.prisma.plmTracker.findUnique({
        where: { id: dto.plmTrackerId },
        select: { productionBoardId: true },
      });
      if (!tracker || tracker.productionBoardId !== list.boardId) {
        throw new BadRequestException(
          'PLM production cards must be created on the tracker’s linked board',
        );
      }
    }
    // Append after the current max position (leaving fractional room after).
    const last = await this.prisma.kanbanCard.findFirst({
      where: { listId, status: KanbanCardStatus.ACTIVE },
      orderBy: { position: 'desc' },
      select: { position: true },
    });
    const position = (last?.position ?? 0) + POSITION_STEP;

    // Vertical is server-owned and always follows the assignee. Clients cannot
    // supply or edit it independently.
    const verticalId = await this.resolveAssigneeVertical(assigneeId);

    const card = await this.prisma.kanbanCard.create({
      data: {
        listId,
        title: dto.title,
        description: dto.description ?? null,
        priority: dto.priority ?? undefined,
        startDate: dto.startDate ? new Date(dto.startDate) : null,
        dueDate: dto.dueDate ? new Date(dto.dueDate) : null,
        assigneeId,
        verticalId,
        plmTrackerId: dto.plmTrackerId ?? null,
        position,
        createdById: user.id,
      },
      include: CARD_INCLUDE,
    });
    return this.toEntity(card);
  }

  /**
   * General edit — any board member. Handles title/description/priority/dates/
   * assignee only. sprintId is absent from UpdateCardDto (and rejected by the
   * global forbidNonWhitelisted pipe), so it can never be changed here.
   */
  async update(
    id: string,
    dto: UpdateCardDto,
    user: AuthenticatedUser,
  ): Promise<KanbanCardEntity> {
    const card = await this.getCardOrThrow(id);
    const editAccess = await this.access.assertCanEditCard(
      user,
      card.list.boardId,
      card.assigneeId,
    );
    if (dto.assigneeId !== undefined && !editAccess.canManageBoard) {
      throw new ForbiddenException(
        'Only a Scrum Master or SUPER_ADMIN may reassign a card',
      );
    }
    if (dto.assigneeId) {
      await this.access.assertAssigneeExists(dto.assigneeId);
    }

    const data: Prisma.KanbanCardUpdateInput = {};
    // Activity descriptions accumulated for fields that ACTUALLY change.
    const descriptions: string[] = [];

    if (dto.title !== undefined) data.title = dto.title;
    if (dto.description !== undefined) data.description = dto.description;

    if (dto.priority !== undefined && dto.priority !== card.priority) {
      data.priority = dto.priority;
      descriptions.push(this.activity.priorityChanged(dto.priority));
    }

    if (dto.startDate !== undefined) {
      const next = dto.startDate ? new Date(dto.startDate) : null;
      if (!sameDate(next, card.startDate)) {
        data.startDate = next;
        descriptions.push(
          this.activity.dateChanged('start', dto.startDate ?? null),
        );
      }
    }
    if (dto.dueDate !== undefined) {
      const next = dto.dueDate ? new Date(dto.dueDate) : null;
      if (!sameDate(next, card.dueDate)) {
        data.dueDate = next;
        descriptions.push(
          this.activity.dateChanged('due', dto.dueDate ?? null),
        );
      }
    }

    // Track a genuine assignee change so we can fire CARD_ASSIGNED after commit.
    let newlyAssignedId: string | null = null;
    let assigneeChanged = false;
    if (dto.assigneeId !== undefined) {
      const nextAssignee = dto.assigneeId ?? null;
      if (nextAssignee !== card.assigneeId) {
        assigneeChanged = true;
        newlyAssignedId = nextAssignee;
        data.assignee = nextAssignee
          ? { connect: { id: nextAssignee } }
          : { disconnect: true };
        // Resolve the new assignee's name for the description.
        let name: string | null = null;
        if (nextAssignee) {
          const emp = await this.prisma.employee.findUnique({
            where: { id: nextAssignee },
            select: { firstName: true, lastName: true },
          });
          name = emp ? `${emp.firstName} ${emp.lastName}` : null;
        }
        descriptions.push(this.activity.assigneeChanged(name));
      }
    }

    // Keep the denormalized reporting field synchronized with the assignee.
    // Unassigning, or assigning someone without a vertical, clears it.
    if (assigneeChanged) {
      const verticalId = await this.resolveAssigneeVertical(newlyAssignedId);
      data.vertical = verticalId
        ? { connect: { id: verticalId } }
        : { disconnect: true };
    }
    // "Meaningful" non-assignment changes (priority/dates) that should notify
    // the current assignee. title/description are excluded per the spec.
    const meaningfulChange =
      (dto.priority !== undefined && dto.priority !== card.priority) ||
      descriptions.some(
        (d) => d.startsWith('set the ') || d.startsWith('cleared the '),
      );

    const updated = await this.prisma.$transaction(async (tx) => {
      const result = await tx.kanbanCard.update({
        where: { id },
        data,
        include: CARD_INCLUDE,
      });
      for (const description of descriptions) {
        await this.activity.log(tx, id, user.id, description);
      }
      return result;
    });

    // Notifications (post-commit; self-notify is skipped inside the service).
    if (assigneeChanged && newlyAssignedId) {
      await this.notifications.notifyAssigned({
        assigneeId: newlyAssignedId,
        actorId: user.id,
        cardId: id,
        cardTitle: updated.title,
      });
    }
    if (meaningfulChange && updated.assigneeId) {
      await this.notifications.notifyUpdated({
        assigneeId: updated.assigneeId,
        actorId: user.id,
        cardId: id,
        summary: `"${updated.title}" was updated`,
      });
    }
    return this.toEntity(updated);
  }

  /**
   * Move a card to a (possibly different) list at a fractional position. The
   * client passes the midpoint between the two neighbours it's dropped between,
   * so the common case is a single-row update — no reindexing. Only when two
   * adjacent positions are closer than MIN_POSITION_GAP do we re-space that
   * list's cards to integer steps and retry.
   */
  async move(
    id: string,
    dto: MoveCardDto,
    user: AuthenticatedUser,
  ): Promise<KanbanCardEntity> {
    const card = await this.getCardOrThrow(id);
    await this.access.assertCanEditCard(
      user,
      card.list.boardId,
      card.assigneeId,
    );

    // The target list must belong to the SAME board (no cross-board moves).
    const targetList = await this.getListOrThrow(dto.listId);
    if (targetList.boardId !== card.list.boardId) {
      throw new BadRequestException(
        'A card can only be moved within its own board',
      );
    }

    let position = dto.position;
    // Guard: if the requested slot collides too tightly with an existing card
    // in the target list, re-space that list first, then append at the end.
    const tooTight = await this.prisma.kanbanCard.findFirst({
      where: {
        listId: dto.listId,
        status: KanbanCardStatus.ACTIVE,
        id: { not: id },
        position: {
          gt: position - MIN_POSITION_GAP,
          lt: position + MIN_POSITION_GAP,
        },
      },
      select: { id: true },
    });
    if (tooTight) {
      await this.respaceList(dto.listId, id);
      const last = await this.prisma.kanbanCard.findFirst({
        where: {
          listId: dto.listId,
          status: KanbanCardStatus.ACTIVE,
          id: { not: id },
        },
        orderBy: { position: 'desc' },
        select: { position: true },
      });
      position = (last?.position ?? 0) + POSITION_STEP;
    }

    // A cross-list move produces an activity entry; a within-list reorder
    // (same listId) doesn't — position-only changes aren't logged.
    const movedLists = dto.listId !== card.listId;
    let moveDescription: string | null = null;
    if (movedLists) {
      const [oldList, newList] = await Promise.all([
        this.prisma.kanbanList.findUnique({
          where: { id: card.listId },
          select: { name: true },
        }),
        this.prisma.kanbanList.findUnique({
          where: { id: dto.listId },
          select: { name: true },
        }),
      ]);
      moveDescription = this.activity.listMoved(
        oldList?.name ?? '(unknown)',
        newList?.name ?? '(unknown)',
      );
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      const result = await tx.kanbanCard.update({
        where: { id },
        data: { listId: dto.listId, position },
        include: CARD_INCLUDE,
      });
      if (moveDescription) {
        await this.activity.log(tx, id, user.id, moveDescription);
      }
      return result;
    });
    return this.toEntity(updated);
  }

  /**
   * Dedicated, privileged sprint assignment — Scrum Master / SUPER_ADMIN only,
   * and only when they can MANAGE the card's board (same gate as list/sprint
   * creation from Phase 1). Kept OUT of the general PATCH so a member can't
   * slip a sprint change through. A provided sprint must belong to the board.
   */
  async setSprint(
    id: string,
    dto: SetCardSprintDto,
    user: AuthenticatedUser,
  ): Promise<KanbanCardEntity> {
    const card = await this.getCardOrThrow(id);
    await this.access.assertCanManageBoard(user, card.list.boardId);

    const nextSprintId = dto.sprintId ?? null;
    let newSprintName: string | null = null;
    if (nextSprintId) {
      const sprint = await this.prisma.kanbanSprint.findUnique({
        where: { id: nextSprintId },
        select: { boardId: true, name: true },
      });
      if (!sprint || sprint.boardId !== card.list.boardId) {
        throw new BadRequestException(
          'The sprint must belong to the same board as the card',
        );
      }
      newSprintName = sprint.name;
    }

    const changed = nextSprintId !== card.sprintId;
    const updated = await this.prisma.$transaction(async (tx) => {
      const result = await tx.kanbanCard.update({
        where: { id },
        data: { sprintId: nextSprintId },
        include: CARD_INCLUDE,
      });
      if (changed) {
        await this.activity.log(
          tx,
          id,
          user.id,
          this.activity.sprintChanged(newSprintName),
        );
      }
      return result;
    });

    // Notify the assignee of a real sprint change (self-notify skipped inside).
    if (changed && updated.assigneeId) {
      await this.notifications.notifyUpdated({
        assigneeId: updated.assigneeId,
        actorId: user.id,
        cardId: id,
        summary: newSprintName
          ? `"${updated.title}" was added to sprint ${newSprintName}`
          : `"${updated.title}" was removed from its sprint`,
      });
    }
    return this.toEntity(updated);
  }

  /** Soft-delete: the assignee, or a managing Scrum Master / SUPER_ADMIN. */
  async archive(id: string, user: AuthenticatedUser): Promise<void> {
    const card = await this.getCardOrThrow(id);
    await this.access.assertCanEditCard(
      user,
      card.list.boardId,
      card.assigneeId,
    );
    await this.prisma.kanbanCard.update({
      where: { id },
      data: { status: KanbanCardStatus.ARCHIVED },
    });
  }

  // ── internals ──────────────────────────────────────────────────────

  /**
   * The vertical of a given assignee (or null when there's no assignee, the
   * employee is missing, or they have no vertical). Used to auto-fill a card's
   * vertical tag. This is the only supported source for a card's vertical.
   */
  private async resolveAssigneeVertical(
    assigneeId: string | null | undefined,
  ): Promise<string | null> {
    if (!assigneeId) return null;
    const emp = await this.prisma.employee.findUnique({
      where: { id: assigneeId },
      select: { verticalId: true },
    });
    return emp?.verticalId ?? null;
  }

  /** Re-space a list's ACTIVE cards to integer steps (rare precision reset). */
  private async respaceList(listId: string, excludeId: string): Promise<void> {
    const cards = await this.prisma.kanbanCard.findMany({
      where: {
        listId,
        status: KanbanCardStatus.ACTIVE,
        id: { not: excludeId },
      },
      orderBy: { position: 'asc' },
      select: { id: true },
    });
    await this.prisma.$transaction(
      cards.map((c, i) =>
        this.prisma.kanbanCard.update({
          where: { id: c.id },
          data: { position: (i + 1) * POSITION_STEP },
        }),
      ),
    );
  }

  private async getListOrThrow(
    listId: string,
  ): Promise<{ id: string; boardId: string }> {
    const list = await this.prisma.kanbanList.findUnique({
      where: { id: listId },
      select: { id: true, boardId: true },
    });
    if (!list) {
      throw new NotFoundException('List not found');
    }
    return list;
  }

  private async getCardOrThrow(id: string): Promise<CardWithList> {
    const card = await this.prisma.kanbanCard.findUnique({
      where: { id },
      include: { list: { select: { boardId: true } } },
    });
    if (!card || card.status === KanbanCardStatus.ARCHIVED) {
      throw new NotFoundException('Card not found');
    }
    return card;
  }

  private toEntity(
    card: KanbanCard & {
      assignee?: { firstName: string; lastName: string } | null;
      vertical?: { name: string; code: string } | null;
      list?: { boardId?: string; isDoneList: boolean } | null;
      labels?: {
        label: { id: string; boardId: string; name: string; color: string };
      }[];
      sprint?: { name: string } | null;
    },
    viewerHasBoardAccess = true,
  ): KanbanCardEntity {
    // Overdue: dueDate is past AND the card's list is not a done-list. When the
    // list flag isn't loaded (older callers), fall back to just the date test.
    const isDoneList = card.list?.isDoneList ?? false;
    const isOverdue =
      !!card.dueDate && card.dueDate.getTime() < Date.now() && !isDoneList;
    return new KanbanCardEntity({
      id: card.id,
      listId: card.listId,
      boardId: card.list?.boardId,
      title: card.title,
      description: card.description,
      assigneeId: card.assigneeId,
      assigneeName: card.assignee
        ? `${card.assignee.firstName} ${card.assignee.lastName}`
        : null,
      verticalId: card.verticalId,
      verticalName: card.vertical?.name ?? null,
      verticalCode: card.vertical?.code ?? null,
      startDate: card.startDate ? card.startDate.toISOString() : null,
      dueDate: card.dueDate ? card.dueDate.toISOString() : null,
      priority: card.priority,
      sprintId: card.sprintId,
      sprintName: card.sprint?.name ?? null,
      position: card.position,
      createdById: card.createdById,
      status: card.status,
      isOverdue,
      viewerHasBoardAccess,
      labels: card.labels?.map((cl) => ({
        id: cl.label.id,
        boardId: cl.label.boardId,
        name: cl.label.name,
        color: cl.label.color,
      })),
      createdAt: card.createdAt.toISOString(),
      updatedAt: card.updatedAt.toISOString(),
    });
  }
}

/** True if two nullable dates represent the same instant (or both null). */
function sameDate(a: Date | null, b: Date | null): boolean {
  if (a === null && b === null) return true;
  if (a === null || b === null) return false;
  return a.getTime() === b.getTime();
}
