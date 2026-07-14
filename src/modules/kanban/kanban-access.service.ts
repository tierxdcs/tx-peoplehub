import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { KanbanBoard, Role } from '@prisma/client';
import { PrismaService } from '../../core/database/prisma.service';
import { AuthenticatedUser } from '../../common/decorators/current-user.decorator';

/**
 * The single place Kanban access is decided. The board's explicit member list
 * is the ONLY access mechanism (boards are NOT vertical-scoped), with two
 * capability overlays:
 *
 *   - SUPER_ADMIN: full override — sees and manages every board, always,
 *     regardless of membership.
 *   - Scrum Master (Employee.isScrumMaster, or SUPER_ADMIN): may create boards
 *     company-wide, and may manage a board (lists/sprints/members/sprint-
 *     assignment) — but a designated Scrum Master must ALSO be a member of the
 *     specific board to manage it (SUPER_ADMIN doesn't need membership).
 *
 * ADMIN gets nothing by default — account-management-only, like every module —
 * unless explicitly added as a board member.
 */
@Injectable()
export class KanbanAccessService {
  constructor(private readonly prisma: PrismaService) {}

  isSuperAdmin(user: AuthenticatedUser): boolean {
    return user.role === Role.SUPER_ADMIN;
  }

  /** Scrum Master capability: SUPER_ADMIN always, or the isScrumMaster flag. */
  async isScrumMaster(user: AuthenticatedUser): Promise<boolean> {
    if (this.isSuperAdmin(user)) {
      return true;
    }
    const me = await this.prisma.employee.findUnique({
      where: { id: user.id },
      select: { isScrumMaster: true },
    });
    return !!me?.isScrumMaster;
  }

  /** Only Scrum Masters / SUPER_ADMIN may create new boards. */
  async assertCanCreateBoard(user: AuthenticatedUser): Promise<void> {
    if (!(await this.isScrumMaster(user))) {
      throw new ForbiddenException(
        'Only a Scrum Master or SUPER_ADMIN may create boards',
      );
    }
  }

  /** True if the user is an explicit member of the board. */
  async isMember(user: AuthenticatedUser, boardId: string): Promise<boolean> {
    return this.isEmployeeMember(user.id, boardId);
  }

  /** True if the given employee id is an explicit member of the board. */
  async isEmployeeMember(
    employeeId: string,
    boardId: string,
  ): Promise<boolean> {
    const membership = await this.prisma.kanbanBoardMember.findUnique({
      where: { boardId_employeeId: { boardId, employeeId } },
      select: { id: true },
    });
    return !!membership;
  }

  /**
   * Assert a would-be card assignee is a member of the card's board — you
   * can't assign a card to someone who can't see it. Reuses the membership
   * check (not a fresh query), per the single-gate design.
   */
  async assertAssigneeIsMember(
    employeeId: string,
    boardId: string,
  ): Promise<void> {
    if (!(await this.isEmployeeMember(employeeId, boardId))) {
      throw new BadRequestException(
        'The assignee must be a member of this board',
      );
    }
  }

  /**
   * All board ids the caller may VIEW: every board for SUPER_ADMIN, otherwise
   * just the ones they're an explicit member of. Used for cross-board reads.
   */
  async viewableBoardIds(user: AuthenticatedUser): Promise<string[]> {
    if (this.isSuperAdmin(user)) {
      const boards = await this.prisma.kanbanBoard.findMany({
        select: { id: true },
      });
      return boards.map((b) => b.id);
    }
    const memberships = await this.prisma.kanbanBoardMember.findMany({
      where: { employeeId: user.id },
      select: { boardId: true },
    });
    return memberships.map((m) => m.boardId);
  }

  /**
   * Load a board the user may VIEW (member, or SUPER_ADMIN). 404 if it doesn't
   * exist, 403 if they can't see it. Returns the board row for reuse.
   */
  async assertCanViewBoard(
    user: AuthenticatedUser,
    boardId: string,
  ): Promise<KanbanBoard> {
    const board = await this.prisma.kanbanBoard.findUnique({
      where: { id: boardId },
    });
    if (!board) {
      throw new NotFoundException('Board not found');
    }
    if (this.isSuperAdmin(user)) {
      return board;
    }
    if (!(await this.isMember(user, boardId))) {
      throw new ForbiddenException('You are not a member of this board');
    }
    return board;
  }

  /**
   * Assert the user may MANAGE the board (create lists/sprints, add/remove
   * members, set a card's sprint). That's Scrum-Master/SUPER_ADMIN territory —
   * and a designated Scrum Master must also be a member of THIS board.
   * SUPER_ADMIN passes via override without needing membership.
   */
  async assertCanManageBoard(
    user: AuthenticatedUser,
    boardId: string,
  ): Promise<KanbanBoard> {
    const board = await this.assertCanViewBoard(user, boardId);
    if (this.isSuperAdmin(user)) {
      return board;
    }
    const scrumMaster = await this.isScrumMaster(user);
    // assertCanViewBoard already proved membership for a non-super-admin.
    if (!scrumMaster) {
      throw new ForbiddenException(
        'Only a Scrum Master (who is a member of this board) or SUPER_ADMIN may manage it',
      );
    }
    return board;
  }
}
