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
 *  - VIEW a kickoff: membership-based, mirroring the Kanban model — the
 *    creating PM, any INTERNAL (employee-linked) attendee, or SUPER_ADMIN.
 *    Deliberately NOT vertical- or Sales-team-wide (spec §4).
 *  - EDIT/DELETE (header fields, attendees, milestones, action items, risks,
 *    delivery classification): Project Manager or SUPER_ADMIN ONLY. A member
 *    who is merely an internal attendee (not a PM) has read-only access — they
 *    can view via assertCanAccess but every mutation is gated by
 *    assertCanManage instead.
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
   * Load a kickoff the user may EDIT/DELETE. Requires BOTH: view access
   * (assertCanAccess — creator, internal attendee, or SUPER_ADMIN) AND the
   * Project Manager capability. A PM with no relation to this kickoff still
   * can't touch it — consistent with them not being able to view it either.
   * An internal attendee who isn't a PM passes step 1 but fails step 2, so
   * they remain read-only. 404 if the kickoff doesn't exist, 403 otherwise.
   */
  async assertCanManage(
    user: AuthenticatedUser,
    kickoffId: string,
  ): Promise<{ id: string; kanbanBoardId: string; orderId: string }> {
    const kickoff = await this.assertCanAccess(user, kickoffId);
    if (!(await this.isProjectManager(user))) {
      throw new ForbiddenException(
        'Only a Project Manager or SUPER_ADMIN may edit a project kickoff',
      );
    }
    return kickoff;
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
