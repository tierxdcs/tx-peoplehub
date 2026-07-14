import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { EmployeeStatus, KanbanBoardStatus } from '@prisma/client';
import { PrismaService } from '../../core/database/prisma.service';
import { AuthenticatedUser } from '../../common/decorators/current-user.decorator';
import { KanbanAccessService } from './kanban-access.service';
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
      return created;
    });
    return this.toBoardEntity({ ...board, _count: { members: 1 } });
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
      include: { employee: { select: { firstName: true, lastName: true, email: true } } },
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
      throw new BadRequestException('employeeId does not reference an employee');
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
      include: { employee: { select: { firstName: true, lastName: true, email: true } } },
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
      throw new NotFoundException('That employee is not a member of this board');
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
