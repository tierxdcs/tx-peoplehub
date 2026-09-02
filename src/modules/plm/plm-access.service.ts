import { ForbiddenException, Injectable } from '@nestjs/common';
import { Role } from '@prisma/client';
import { AuthenticatedUser } from '../../common/decorators/current-user.decorator';
import { PrismaService } from '../../core/database/prisma.service';

@Injectable()
export class PlmAccessService {
  constructor(private readonly prisma: PrismaService) {}

  /** Company-wide PLM authority: Super Admin, Production Head, or Project Manager. */
  async hasFullAccess(user: AuthenticatedUser): Promise<boolean> {
    if (user.role === Role.SUPER_ADMIN) return true;
    const employee = await this.prisma.employee.findUnique({
      where: { id: user.id },
      select: { isProductionHead: true, isProjectManager: true },
    });
    return !!(employee?.isProductionHead || employee?.isProjectManager);
  }

  async isProductionHead(user: AuthenticatedUser): Promise<boolean> {
    if (user.role === Role.SUPER_ADMIN) return true;
    const employee = await this.prisma.employee.findUnique({
      where: { id: user.id },
      select: { isProductionHead: true },
    });
    return !!employee?.isProductionHead;
  }

  /**
   * Moving the lifecycle is a project-control decision. Tracker ownership,
   * Production Head status, and general PLM visibility deliberately do not
   * grant this permission.
   */
  async assertCanConfirmStage(user: AuthenticatedUser): Promise<void> {
    if (user.role === Role.SUPER_ADMIN) return;
    const employee = await this.prisma.employee.findUnique({
      where: { id: user.id },
      select: { isProjectManager: true },
    });
    if (employee?.isProjectManager) return;
    throw new ForbiddenException(
      'Only a Project Manager or CEO/SUPER_ADMIN may confirm a PLM stage',
    );
  }

  async assertProductionHead(user: AuthenticatedUser): Promise<void> {
    if (!(await this.hasFullAccess(user))) {
      throw new ForbiddenException(
        'Only a Project Manager, Production Head, or SUPER_ADMIN may perform this action',
      );
    }
  }

  async assertCanOperate(
    user: AuthenticatedUser,
    ownerId: string,
  ): Promise<void> {
    if (user.id === ownerId || (await this.hasFullAccess(user))) return;
    throw new ForbiddenException(
      'Only the tracker owner, a Project Manager, Production Head, or SUPER_ADMIN may advance this tracker',
    );
  }

  async assertCanCompleteDesign(user: AuthenticatedUser): Promise<void> {
    if (user.role === Role.SUPER_ADMIN) return;
    const employee = await this.prisma.employee.findUnique({
      where: { id: user.id },
      select: {
        isDesignHead: true,
        isRdHead: true,
        isProjectManager: true,
        vertical: { select: { code: true } },
      },
    });
    if (
      employee?.isDesignHead ||
      employee?.isRdHead ||
      employee?.isProjectManager ||
      ['DESIGN', 'RND'].includes(employee?.vertical?.code ?? '')
    ) {
      return;
    }
    throw new ForbiddenException(
      'Only Design, R&D, a Project Manager, or SUPER_ADMIN may submit Design for review',
    );
  }

  async assertInternalAuditor(user: AuthenticatedUser): Promise<void> {
    if (user.role === Role.SUPER_ADMIN) return;
    const employee = await this.prisma.employee.findUnique({
      where: { id: user.id },
      select: { isInternalAuditor: true, isProjectManager: true },
    });
    if (employee?.isInternalAuditor || employee?.isProjectManager) return;
    throw new ForbiddenException(
      'Only an Internal Auditor, Project Manager, or SUPER_ADMIN may record a vendor site-visit update',
    );
  }

  async assertCanViewTracker(
    user: AuthenticatedUser,
    trackerId: string,
  ): Promise<void> {
    if (user.role === Role.SUPER_ADMIN) return;
    const [tracker, employee] = await Promise.all([
      this.prisma.plmTracker.findUnique({
        where: { id: trackerId },
        select: {
          ownerId: true,
          order: { select: { ownerId: true } },
          kickoff: {
            select: {
              attendees: {
                where: { employeeId: user.id },
                select: { id: true },
              },
            },
          },
        },
      }),
      this.prisma.employee.findUnique({
        where: { id: user.id },
        select: {
          isProductionHead: true,
          isInternalAuditor: true,
          isProjectManager: true,
        },
      }),
    ]);
    if (
      tracker &&
      (tracker.ownerId === user.id ||
        tracker.order.ownerId === user.id ||
        tracker.kickoff.attendees.length > 0 ||
        employee?.isProductionHead ||
        employee?.isInternalAuditor ||
        employee?.isProjectManager)
    ) {
      return;
    }
    throw new ForbiddenException('You are not involved in this PLM tracker');
  }

  async assertCanViewOrder(
    user: AuthenticatedUser,
    orderId: string,
  ): Promise<void> {
    if (user.role === Role.SUPER_ADMIN) return;
    const tracker = await this.prisma.plmTracker.findFirst({
      where: {
        orderId,
        OR: [
          { ownerId: user.id },
          { order: { ownerId: user.id } },
          { kickoff: { attendees: { some: { employeeId: user.id } } } },
        ],
      },
      select: { id: true },
    });
    if (tracker) return;
    const employee = await this.prisma.employee.findUnique({
      where: { id: user.id },
      select: {
        isProductionHead: true,
        isInternalAuditor: true,
        isProjectManager: true,
      },
    });
    if (
      employee?.isProductionHead ||
      employee?.isInternalAuditor ||
      employee?.isProjectManager
    )
      return;
    throw new ForbiddenException(
      'You are not involved in this order’s PLM work',
    );
  }
}
