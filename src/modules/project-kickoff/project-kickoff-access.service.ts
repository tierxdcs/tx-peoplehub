import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Role } from '@prisma/client';
import { PrismaService } from '../../core/database/prisma.service';
import { AuthenticatedUser } from '../../common/decorators/current-user.decorator';

/**
 * The single place Project Kickoff access is decided.
 *
 *  - CREATE: a Project Manager (Employee.isProjectManager) or SUPER_ADMIN.
 *  - VIEW/EDIT a kickoff: membership-based, mirroring the Kanban model — the
 *    creating PM, any INTERNAL (employee-linked) attendee, or SUPER_ADMIN.
 *    Deliberately NOT vertical- or Sales-team-wide (spec §4).
 *
 * SUPER_ADMIN is always treated as a Project Manager regardless of the flag,
 * matching the Scrum Master / Sales Head override convention.
 */
@Injectable()
export class ProjectKickoffAccessService {
  constructor(private readonly prisma: PrismaService) {}

  isSuperAdmin(user: AuthenticatedUser): boolean {
    return user.role === Role.SUPER_ADMIN;
  }

  /** PM capability: SUPER_ADMIN always, or the isProjectManager flag. */
  async isProjectManager(user: AuthenticatedUser): Promise<boolean> {
    if (this.isSuperAdmin(user)) return true;
    const me = await this.prisma.employee.findUnique({
      where: { id: user.id },
      select: { isProjectManager: true },
    });
    return !!me?.isProjectManager;
  }

  async assertCanCreate(user: AuthenticatedUser): Promise<void> {
    if (!(await this.isProjectManager(user))) {
      throw new ForbiddenException(
        'Only a Project Manager or SUPER_ADMIN may create a project kickoff',
      );
    }
  }

  /**
   * Load a kickoff the user may access (creator, internal attendee, or
   * SUPER_ADMIN). 404 if it doesn't exist, 403 if they can't see it. Returns
   * the minimal row for reuse by callers.
   */
  async assertCanAccess(
    user: AuthenticatedUser,
    kickoffId: string,
  ): Promise<{ id: string; kanbanBoardId: string; orderId: string }> {
    const kickoff = await this.prisma.projectKickoff.findUnique({
      where: { id: kickoffId },
      select: {
        id: true,
        kanbanBoardId: true,
        orderId: true,
        createdById: true,
        attendees: { select: { employeeId: true } },
      },
    });
    if (!kickoff) {
      throw new NotFoundException('Project kickoff not found');
    }
    if (this.isSuperAdmin(user)) return kickoff;

    const isCreator = kickoff.createdById === user.id;
    const isInternalAttendee = kickoff.attendees.some(
      (a) => a.employeeId === user.id,
    );
    if (!isCreator && !isInternalAttendee) {
      throw new ForbiddenException(
        'You do not have access to this project kickoff',
      );
    }
    return kickoff;
  }
}
