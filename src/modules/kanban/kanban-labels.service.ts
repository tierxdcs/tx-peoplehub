import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { KanbanCardStatus } from '@prisma/client';
import { PrismaService } from '../../core/database/prisma.service';
import { AuthenticatedUser } from '../../common/decorators/current-user.decorator';
import { KanbanAccessService } from './kanban-access.service';
import { CreateLabelDto, UpdateLabelDto } from './dto/kanban.dto';
import { KanbanCardEntity, KanbanLabelEntity } from './entities/kanban.entity';

/**
 * Board labels. Definition (create/edit/delete) is Scrum-Master/SUPER_ADMIN
 * territory, mirroring lists/sprints. Attaching/detaching a label to a card is
 * open to any board member — it's an everyday triage action, not board setup.
 */
@Injectable()
export class KanbanLabelsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: KanbanAccessService,
  ) {}

  /** Any board member may list a board's labels. */
  async listLabels(
    boardId: string,
    user: AuthenticatedUser,
  ): Promise<KanbanLabelEntity[]> {
    await this.access.assertCanViewBoard(user, boardId);
    const labels = await this.prisma.kanbanLabel.findMany({
      where: { boardId },
      orderBy: { name: 'asc' },
    });
    return labels.map((l) => this.toEntity(l));
  }

  /** Create a label — Scrum Master / SUPER_ADMIN. */
  async createLabel(
    boardId: string,
    dto: CreateLabelDto,
    user: AuthenticatedUser,
  ): Promise<KanbanLabelEntity> {
    await this.access.assertCanManageBoard(user, boardId);
    const label = await this.prisma.kanbanLabel.create({
      data: { boardId, name: dto.name, color: dto.color },
    });
    return this.toEntity(label);
  }

  /** Edit a label — Scrum Master / SUPER_ADMIN. */
  async updateLabel(
    id: string,
    dto: UpdateLabelDto,
    user: AuthenticatedUser,
  ): Promise<KanbanLabelEntity> {
    const label = await this.getLabelOrThrow(id);
    await this.access.assertCanManageBoard(user, label.boardId);
    const updated = await this.prisma.kanbanLabel.update({
      where: { id },
      data: {
        ...(dto.name !== undefined ? { name: dto.name } : {}),
        ...(dto.color !== undefined ? { color: dto.color } : {}),
      },
    });
    return this.toEntity(updated);
  }

  /** Delete a label (detaches it from every card via cascade) — SM/SUPER_ADMIN. */
  async deleteLabel(id: string, user: AuthenticatedUser): Promise<void> {
    const label = await this.getLabelOrThrow(id);
    await this.access.assertCanManageBoard(user, label.boardId);
    await this.prisma.kanbanLabel.delete({ where: { id } });
  }

  /** Attach a label to a card — any board member. Label must be on the same board. */
  async attach(
    cardId: string,
    labelId: string,
    user: AuthenticatedUser,
  ): Promise<KanbanCardEntity> {
    const { boardId } = await this.assertCardAndLabelSameBoard(cardId, labelId);
    await this.access.assertCanViewBoard(user, boardId);
    // Idempotent: ignore a duplicate attach.
    await this.prisma.kanbanCardLabel.upsert({
      where: { cardId_labelId: { cardId, labelId } },
      create: { cardId, labelId },
      update: {},
    });
    return this.cardEntity(cardId);
  }

  /** Detach a label from a card — any board member. */
  async detach(
    cardId: string,
    labelId: string,
    user: AuthenticatedUser,
  ): Promise<KanbanCardEntity> {
    const { boardId } = await this.assertCardAndLabelSameBoard(cardId, labelId);
    await this.access.assertCanViewBoard(user, boardId);
    await this.prisma.kanbanCardLabel.deleteMany({ where: { cardId, labelId } });
    return this.cardEntity(cardId);
  }

  // ── internals ──────────────────────────────────────────────────────

  private async getLabelOrThrow(
    id: string,
  ): Promise<{ id: string; boardId: string }> {
    const label = await this.prisma.kanbanLabel.findUnique({
      where: { id },
      select: { id: true, boardId: true },
    });
    if (!label) throw new NotFoundException('Label not found');
    return label;
  }

  /** Both the card and the label must exist and live on the same board. */
  private async assertCardAndLabelSameBoard(
    cardId: string,
    labelId: string,
  ): Promise<{ boardId: string }> {
    const [card, label] = await Promise.all([
      this.prisma.kanbanCard.findUnique({
        where: { id: cardId },
        select: { status: true, list: { select: { boardId: true } } },
      }),
      this.prisma.kanbanLabel.findUnique({
        where: { id: labelId },
        select: { boardId: true },
      }),
    ]);
    if (!card || card.status === KanbanCardStatus.ARCHIVED) {
      throw new NotFoundException('Card not found');
    }
    if (!label) throw new NotFoundException('Label not found');
    if (card.list.boardId !== label.boardId) {
      throw new BadRequestException(
        'The label must belong to the same board as the card',
      );
    }
    return { boardId: label.boardId };
  }

  /** Re-read a card with its labels for the response after attach/detach. */
  private async cardEntity(cardId: string): Promise<KanbanCardEntity> {
    const card = await this.prisma.kanbanCard.findUniqueOrThrow({
      where: { id: cardId },
      include: {
        assignee: { select: { firstName: true, lastName: true } },
        list: { select: { isDoneList: true } },
        labels: { include: { label: true } },
      },
    });
    const isDoneList = card.list?.isDoneList ?? false;
    const isOverdue =
      !!card.dueDate && card.dueDate.getTime() < Date.now() && !isDoneList;
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
      isOverdue,
      labels: card.labels.map((cl) => ({
        id: cl.label.id,
        boardId: cl.label.boardId,
        name: cl.label.name,
        color: cl.label.color,
      })),
      createdAt: card.createdAt.toISOString(),
      updatedAt: card.updatedAt.toISOString(),
    });
  }

  private toEntity(l: {
    id: string;
    boardId: string;
    name: string;
    color: string;
  }): KanbanLabelEntity {
    return new KanbanLabelEntity({
      id: l.id,
      boardId: l.boardId,
      name: l.name,
      color: l.color,
    });
  }
}
