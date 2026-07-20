import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  EmployeeStatus,
  KanbanBoardStatus,
  KanbanCardStatus,
} from '@prisma/client';
import { PrismaService } from '../../core/database/prisma.service';
import { AuthenticatedUser } from '../../common/decorators/current-user.decorator';
import { KanbanAccessService } from './kanban-access.service';
import { KanbanBoardProvisioningService } from './kanban-board-provisioning.service';
import { CreateBoardDto, AddBoardMemberDto } from './dto/kanban.dto';
import {
  KanbanBoardEntity,
  KanbanBoardMemberEntity,
} from './entities/kanban.entity';

@Injectable()
export class KanbanBoardsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: KanbanAccessService,
    private readonly provisioning: KanbanBoardProvisioningService,
  ) {}

  /**
   * Create a board (Scrum Master / SUPER_ADMIN). The creator is auto-added as
   * the first member so they can never be locked out of their own board.
   */
  async create(
    dto: CreateBoardDto,
    user: AuthenticatedUser,
  ): Promise<KanbanBoardEntity> {
    await this.access.assertCanCreateBoard(user);
    const board = await this.prisma.$transaction(async (tx) => {
      const created = await tx.kanbanBoard.create({
        data: { name: dto.name, createdById: user.id },
      });
      await tx.kanbanBoardMember.create({
        data: {
          boardId: created.id,
          employeeId: user.id,
          addedById: user.id,
        },
      });
      await this.provisioning.createDefaultLists(tx, created.id, user.id);
      return created;
    });
    return this.toBoardEntity({ ...board, _count: { members: 1 } });
  }

  /**
   * PRIVILEGED internal provisioning — NOT exposed on the human-facing API and
   * deliberately bypassing the Scrum-Master access gates. Used by the Project
   * Kickoff module to stand up a project board as a side effect of kickoff
   * creation (§5): a board named after the project, the three default lists
   * (To Do / In progress / Completed, the last a done-list), and initial members
   * (creator + internal attendees). All in one transaction. Returns the ids the
   * caller needs to wire up (board + the To Do list for action-item cards).
   *
   * `createdById` becomes the board/list author and each membership's addedBy —
   * pass the real kickoff creator's employee id. `memberEmployeeIds` is
   * de-duplicated and always includes the creator.
   */
  async provisionProjectBoard(input: {
    name: string;
    createdById: string;
    memberEmployeeIds: string[];
  }): Promise<{ boardId: string; todoListId: string }> {
    const memberIds = Array.from(
      new Set([input.createdById, ...input.memberEmployeeIds]),
    );
    return this.prisma.$transaction(async (tx) => {
      const board = await tx.kanbanBoard.create({
        data: { name: input.name, createdById: input.createdById },
      });
      await tx.kanbanBoardMember.createMany({
        data: memberIds.map((employeeId) => ({
          boardId: board.id,
          employeeId,
          addedById: input.createdById,
        })),
      });
      const { todoListId } = await this.provisioning.createDefaultLists(
        tx,
        board.id,
        input.createdById,
      );
      return { boardId: board.id, todoListId };
    });
  }

  /**
   * PRIVILEGED internal helper: ensure an employee is a member of a board
   * (idempotent). Used when an action item's owner isn't already on the project
   * board — a card's assignee must be a board member. Bypasses access gates.
   */
  async ensureMember(boardId: string, employeeId: string): Promise<void> {
    await this.prisma.kanbanBoardMember.upsert({
      where: { boardId_employeeId: { boardId, employeeId } },
      create: { boardId, employeeId, addedById: employeeId },
      update: {},
    });
  }

  async doneListBackfillReport(user: AuthenticatedUser) {
    if (!this.access.isSuperAdmin(user))
      throw new ForbiddenException(
        'Only SUPER_ADMIN may view the done-list backfill report',
      );
    return this.prisma.kanbanDoneListBackfillReport.findMany({
      orderBy: { boardName: 'asc' },
    });
  }

  /**
   * PRIVILEGED internal helper: append an ACTIVE card to a list, assigned to
   * an owner, on the same fractional-position scheme as the normal card path
   * (last position + 1024). Bypasses access gates. The caller must have already
   * ensured the assignee is a board member. Returns the new card id so the
   * action item can store its kanbanCardId.
   */
  async provisionActionCard(input: {
    listId: string;
    title: string;
    assigneeId: string;
    createdById: string;
    dueDate: Date | null;
  }): Promise<string> {
    const last = await this.prisma.kanbanCard.findFirst({
      where: { listId: input.listId, status: KanbanCardStatus.ACTIVE },
      orderBy: { position: 'desc' },
      select: { position: true },
    });
    const position = (last?.position ?? 0) + 1024;
    // Auto-tag the card with the assignee's vertical so per-vertical completion
    // works on project boards (this is the kickoff action-item path — exactly
    // where cross-department progress tracking matters). Editable later.
    const owner = await this.prisma.employee.findUnique({
      where: { id: input.assigneeId },
      select: { verticalId: true },
    });
    const card = await this.prisma.kanbanCard.create({
      data: {
        listId: input.listId,
        title: input.title,
        assigneeId: input.assigneeId,
        verticalId: owner?.verticalId ?? null,
        dueDate: input.dueDate,
        position,
        createdById: input.createdById,
      },
      select: { id: true },
    });
    return card.id;
  }

  /** Boards the caller can see: their memberships, or all for SUPER_ADMIN. */
  async findAll(user: AuthenticatedUser): Promise<KanbanBoardEntity[]> {
    const where = this.access.isSuperAdmin(user)
      ? { status: KanbanBoardStatus.ACTIVE }
      : {
          status: KanbanBoardStatus.ACTIVE,
          members: { some: { employeeId: user.id } },
        };
    const boards = await this.prisma.kanbanBoard.findMany({
      where,
      include: { _count: { select: { members: true } } },
      orderBy: { createdAt: 'desc' },
    });
    return boards.map((b) => this.toBoardEntity(b));
  }

  async findOne(
    id: string,
    user: AuthenticatedUser,
  ): Promise<KanbanBoardEntity> {
    await this.access.assertCanViewBoard(user, id);
    const board = await this.prisma.kanbanBoard.findUniqueOrThrow({
      where: { id },
      include: { _count: { select: { members: true } } },
    });
    return this.toBoardEntity(board);
  }

  async archive(id: string, user: AuthenticatedUser): Promise<void> {
    await this.access.assertCanManageBoard(user, id);
    await this.prisma.kanbanBoard.update({
      where: { id },
      data: { status: KanbanBoardStatus.ARCHIVED },
    });
  }

  // ── Members ────────────────────────────────────────────────────────

  async listMembers(
    boardId: string,
    user: AuthenticatedUser,
  ): Promise<KanbanBoardMemberEntity[]> {
    await this.access.assertCanViewBoard(user, boardId);
    const members = await this.prisma.kanbanBoardMember.findMany({
      where: { boardId },
      include: {
        employee: { select: { firstName: true, lastName: true, email: true } },
      },
      orderBy: { addedAt: 'asc' },
    });
    return members.map((m) => this.toMemberEntity(m));
  }

  /** Add a member (Scrum Master / SUPER_ADMIN). Idempotent-ish: rejects dup. */
  async addMember(
    boardId: string,
    dto: AddBoardMemberDto,
    user: AuthenticatedUser,
  ): Promise<KanbanBoardMemberEntity> {
    await this.access.assertCanManageBoard(user, boardId);
    const employee = await this.prisma.employee.findUnique({
      where: { id: dto.employeeId },
      select: { id: true, status: true },
    });
    if (!employee) {
      throw new BadRequestException(
        'employeeId does not reference an employee',
      );
    }
    if (employee.status !== EmployeeStatus.ACTIVE) {
      throw new BadRequestException('Cannot add an inactive employee');
    }
    const existing = await this.prisma.kanbanBoardMember.findUnique({
      where: { boardId_employeeId: { boardId, employeeId: dto.employeeId } },
    });
    if (existing) {
      throw new BadRequestException('That employee is already a board member');
    }
    const member = await this.prisma.kanbanBoardMember.create({
      data: { boardId, employeeId: dto.employeeId, addedById: user.id },
      include: {
        employee: { select: { firstName: true, lastName: true, email: true } },
      },
    });
    return this.toMemberEntity(member);
  }

  /** Remove a member. The board creator can't be removed (never orphan it). */
  async removeMember(
    boardId: string,
    employeeId: string,
    user: AuthenticatedUser,
  ): Promise<void> {
    const board = await this.access.assertCanManageBoard(user, boardId);
    if (employeeId === board.createdById) {
      throw new BadRequestException(
        'The board creator cannot be removed from the board',
      );
    }
    const member = await this.prisma.kanbanBoardMember.findUnique({
      where: { boardId_employeeId: { boardId, employeeId } },
    });
    if (!member) {
      throw new NotFoundException(
        'That employee is not a member of this board',
      );
    }
    await this.prisma.kanbanBoardMember.delete({ where: { id: member.id } });
  }

  // ── mappers ────────────────────────────────────────────────────────

  private toBoardEntity(board: {
    id: string;
    name: string;
    createdById: string;
    status: KanbanBoardStatus;
    createdAt: Date;
    updatedAt: Date;
    _count: { members: number };
  }): KanbanBoardEntity {
    return new KanbanBoardEntity({
      id: board.id,
      name: board.name,
      createdById: board.createdById,
      status: board.status,
      memberCount: board._count.members,
      createdAt: board.createdAt.toISOString(),
      updatedAt: board.updatedAt.toISOString(),
    });
  }

  private toMemberEntity(m: {
    id: string;
    boardId: string;
    employeeId: string;
    addedById: string;
    addedAt: Date;
    employee: { firstName: string; lastName: string; email: string } | null;
  }): KanbanBoardMemberEntity {
    return new KanbanBoardMemberEntity({
      id: m.id,
      boardId: m.boardId,
      employeeId: m.employeeId,
      employeeName: m.employee
        ? `${m.employee.firstName} ${m.employee.lastName}`
        : null,
      employeeEmail: m.employee?.email ?? null,
      addedById: m.addedById,
      addedAt: m.addedAt.toISOString(),
    });
  }
}
