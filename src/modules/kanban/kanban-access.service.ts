import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { EmployeeStatus, KanbanBoard, Role } from '@prisma/client';
import { PrismaService } from '../../core/database/prisma.service';
import { AuthenticatedUser } from '../../common/decorators/current-user.decorator';

/**
 * The single place Kanban access is decided. The board's explicit member list
 * is the primary access mechanism (boards are NOT vertical-scoped), with
 * capability overlays:
 *
 *   - SUPER_ADMIN: full override — sees and manages every board, always,
 *     regardless of membership.
 *   - Scrum Master (Employee.isScrumMaster, or SUPER_ADMIN): may manage a
 *     board's sprints/members/labels (lists/sprints/members/sprint-
 *     assignment) — but a designated Scrum Master must ALSO be a member of
 *     the specific board to manage it (SUPER_ADMIN doesn't need membership).
 *   - Board creator: may manage LISTS on a board they personally created,
 *     even without being a Scrum Master — see assertCanManageLists. This is
 *     scoped to lists (+ cards, already open to any member); it does NOT
 *     extend to sprints, members, or labels, which stay Scrum-Master-only
 *     with no creator exception (assertCanManageBoard).
 *   - Card owner: the employee who created a card retains its structural edit
 *     rights after assigning it to someone else.
 *   - Card-only access: a card's assignee may view and comment on that single
 *     card even without board membership — see assertCanViewCard.
 *     Assignment is the sharing mechanism now that assignment no longer
 *     requires board membership (assertAssigneeExists).
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
   * Assert a would-be card assignee is a real, ACTIVE employee. Board
   * membership is NOT required — assignment itself is now the sharing
   * mechanism: a non-member assignee gets restricted "card-only" access
   * (see assertCanViewCard) rather than full board membership.
   */
  async assertAssigneeExists(employeeId: string): Promise<void> {
    const employee = await this.prisma.employee.findUnique({
      where: { id: employeeId },
      select: { status: true },
    });
    if (!employee) {
      throw new BadRequestException(
        'employeeId does not reference an employee',
      );
    }
    if (employee.status !== EmployeeStatus.ACTIVE) {
      throw new BadRequestException(
        'Cannot assign a card to an inactive employee',
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
   * Assert the user may MANAGE the board (sprints, members, labels, a card's
   * sprint). That's Scrum-Master/SUPER_ADMIN territory — and a designated
   * Scrum Master must also be a member of THIS board. SUPER_ADMIN passes via
   * override without needing membership. NO creator exception here — a
   * personal-board owner who isn't a Scrum Master still can't create sprints
   * or manage members/labels on their own board (see assertCanManageLists
   * for the narrower carve-out that DOES apply to them).
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

  /**
   * Assert the user may manage LISTS on the board (create/edit/reorder/
   * delete) — Scrum-Master/SUPER_ADMIN territory, OR the board's own creator.
   * This is the one deliberate carve-out for a personal-board owner who isn't
   * a Scrum Master: they can still organise their own board's lists and cards
   * (card management is already open to any member). It does NOT extend to
   * sprints/members/labels — those stay on assertCanManageBoard with no
   * creator exception.
   */
  async assertCanManageLists(
    user: AuthenticatedUser,
    boardId: string,
  ): Promise<KanbanBoard> {
    const board = await this.assertCanViewBoard(user, boardId);
    if (this.isSuperAdmin(user)) {
      return board;
    }
    if (board.createdById === user.id) {
      return board;
    }
    const scrumMaster = await this.isScrumMaster(user);
    if (!scrumMaster) {
      throw new ForbiddenException(
        'Only the board creator, a Scrum Master (who is a member of this board), or SUPER_ADMIN may manage its lists',
      );
    }
    return board;
  }

  /**
   * Assert the user may view a specific CARD — either full board access
   * (assertCanViewBoard), or being that card's assignee (card-only access,
   * no board membership needed). Returns which kind of access was granted so
   * callers can further restrict behaviour for a card-only viewer (e.g. hide
   * "Mark complete", which requires board membership).
   */
  async assertCanViewCard(
    user: AuthenticatedUser,
    boardId: string,
    cardAssigneeId: string | null,
  ): Promise<{ hasBoardAccess: boolean }> {
    if (this.isSuperAdmin(user) || (await this.isMember(user, boardId))) {
      return { hasBoardAccess: true };
    }
    if (cardAssigneeId && cardAssigneeId === user.id) {
      return { hasBoardAccess: false };
    }
    throw new ForbiddenException(
      'You are not a member of this board or the assignee of this card',
    );
  }

  /** Structural edits are limited to the card creator or a board manager. */
  async assertCanEditCard(
    user: AuthenticatedUser,
    boardId: string,
    cardAssigneeId: string | null,
    cardCreatedById: string,
  ): Promise<{ canManageBoard: boolean }> {
    if (this.isSuperAdmin(user)) return { canManageBoard: true };
    if (cardCreatedById === user.id) {
      await this.assertCanViewCard(user, boardId, cardAssigneeId);
      return { canManageBoard: false };
    }
    await this.assertCanManageBoard(user, boardId);
    return { canManageBoard: true };
  }
}
