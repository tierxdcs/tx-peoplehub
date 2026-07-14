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
import {
  CreateCardDto,
  MoveCardDto,
  SetCardSprintDto,
  UpdateCardDto,
} from './dto/kanban.dto';
import { KanbanCardEntity } from './entities/kanban.entity';

/**
 * Smallest gap between two adjacent fractional positions before we bother
 * re-spacing a list. Well above float epsilon so we never actually run out of
 * precision, but we still handle the case deterministically.
 */
const MIN_POSITION_GAP = 1e-6;
/** Spacing used when appending / re-spacing (integers, leaving room between). */
const POSITION_STEP = 1024;

type CardWithList = KanbanCard & { list: { boardId: string } };

@Injectable()
export class KanbanCardsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: KanbanAccessService,
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
      include: { assignee: { select: { firstName: true, lastName: true } } },
      orderBy: { position: 'asc' },
    });
    return cards.map((c) => this.toEntity(c));
  }

  /** Create a card in a list — any board member. sprintId is NOT settable. */
  async create(
    listId: string,
    dto: CreateCardDto,
    user: AuthenticatedUser,
  ): Promise<KanbanCardEntity> {
    const list = await this.getListOrThrow(listId);
    await this.access.assertCanViewBoard(user, list.boardId);
    if (dto.assigneeId) {
      await this.access.assertAssigneeIsMember(dto.assigneeId, list.boardId);
    }
    // Append after the current max position (leaving fractional room after).
    const last = await this.prisma.kanbanCard.findFirst({
      where: { listId, status: KanbanCardStatus.ACTIVE },
      orderBy: { position: 'desc' },
      select: { position: true },
    });
    const position = (last?.position ?? 0) + POSITION_STEP;

    const card = await this.prisma.kanbanCard.create({
      data: {
        listId,
        title: dto.title,
        description: dto.description ?? null,
        priority: dto.priority ?? undefined,
        startDate: dto.startDate ? new Date(dto.startDate) : null,
        dueDate: dto.dueDate ? new Date(dto.dueDate) : null,
        assigneeId: dto.assigneeId ?? null,
        position,
        createdById: user.id,
      },
      include: { assignee: { select: { firstName: true, lastName: true } } },
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
    await this.access.assertCanViewBoard(user, card.list.boardId);
    if (dto.assigneeId) {
      await this.access.assertAssigneeIsMember(dto.assigneeId, card.list.boardId);
    }

    const data: Prisma.KanbanCardUpdateInput = {};
    if (dto.title !== undefined) data.title = dto.title;
    if (dto.description !== undefined) data.description = dto.description;
    if (dto.priority !== undefined) data.priority = dto.priority;
    if (dto.startDate !== undefined) {
      data.startDate = dto.startDate ? new Date(dto.startDate) : null;
    }
    if (dto.dueDate !== undefined) {
      data.dueDate = dto.dueDate ? new Date(dto.dueDate) : null;
    }
    if (dto.assigneeId !== undefined) {
      data.assignee = dto.assigneeId
        ? { connect: { id: dto.assigneeId } }
        : { disconnect: true };
    }

    const updated = await this.prisma.kanbanCard.update({
      where: { id },
      data,
      include: { assignee: { select: { firstName: true, lastName: true } } },
    });
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
    await this.access.assertCanViewBoard(user, card.list.boardId);

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

    const updated = await this.prisma.kanbanCard.update({
      where: { id },
      data: { listId: dto.listId, position },
      include: { assignee: { select: { firstName: true, lastName: true } } },
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

    if (dto.sprintId) {
      const sprint = await this.prisma.kanbanSprint.findUnique({
        where: { id: dto.sprintId },
        select: { boardId: true },
      });
      if (!sprint || sprint.boardId !== card.list.boardId) {
        throw new BadRequestException(
          'The sprint must belong to the same board as the card',
        );
      }
    }

    const updated = await this.prisma.kanbanCard.update({
      where: { id },
      data: { sprintId: dto.sprintId ?? null },
      include: { assignee: { select: { firstName: true, lastName: true } } },
    });
    return this.toEntity(updated);
  }

  /**
   * Soft-delete (→ ARCHIVED). Deliberate rule: the card's CREATOR, or a
   * Scrum Master / SUPER_ADMIN who manages the board, may delete — NOT every
   * member (a member shouldn't be able to wipe a colleague's card).
   */
  async archive(id: string, user: AuthenticatedUser): Promise<void> {
    const card = await this.getCardOrThrow(id);
    await this.access.assertCanViewBoard(user, card.list.boardId);
    const isOwner = card.createdById === user.id;
    const canManage = await this.access
      .assertCanManageBoard(user, card.list.boardId)
      .then(() => true)
      .catch(() => false);
    if (!isOwner && !canManage) {
      throw new ForbiddenException(
        'Only the card creator or a Scrum Master/SUPER_ADMIN may delete this card',
      );
    }
    await this.prisma.kanbanCard.update({
      where: { id },
      data: { status: KanbanCardStatus.ARCHIVED },
    });
  }

  // ── internals ──────────────────────────────────────────────────────

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
    },
  ): KanbanCardEntity {
    return new KanbanCardEntity({
      id: card.id,
      listId: card.listId,
      title: card.title,
      description: card.description,
      assigneeId: card.assigneeId,
      assigneeName: card.assignee
        ? `${card.assignee.firstName} ${card.assignee.lastName}`
        : null,
      startDate: card.startDate ? card.startDate.toISOString() : null,
      dueDate: card.dueDate ? card.dueDate.toISOString() : null,
      priority: card.priority,
      sprintId: card.sprintId,
      position: card.position,
      createdById: card.createdById,
      status: card.status,
      createdAt: card.createdAt.toISOString(),
      updatedAt: card.updatedAt.toISOString(),
    });
  }
}
