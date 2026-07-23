import { ForbiddenException, Injectable } from '@nestjs/common';
import { Role } from '@prisma/client';
import { AuthenticatedUser } from '../../common/decorators/current-user.decorator';
import { PrismaService } from '../../core/database/prisma.service';

@Injectable()
export class PlmAccessService {
  constructor(private readonly prisma: PrismaService) {}

  async isProductionHead(user: AuthenticatedUser): Promise<boolean> {
    if (user.role === Role.SUPER_ADMIN) return true;
    const employee = await this.prisma.employee.findUnique({
      where: { id: user.id },
      select: { isProductionHead: true },
    });
    return !!employee?.isProductionHead;
  }

  async assertProductionHead(user: AuthenticatedUser): Promise<void> {
    if (!(await this.isProductionHead(user))) {
      throw new ForbiddenException(
        'Only a Production Head or SUPER_ADMIN may perform this action',
      );
    }
  }

  async assertCanOperate(
    user: AuthenticatedUser,
    ownerId: string,
  ): Promise<void> {
    if (user.id === ownerId || (await this.isProductionHead(user))) return;
    throw new ForbiddenException(
      'Only the tracker owner, a Production Head, or SUPER_ADMIN may advance this tracker',
    );
  }

  async assertCanCompleteDesign(user: AuthenticatedUser): Promise<void> {
    if (user.role === Role.SUPER_ADMIN) return;
    const employee = await this.prisma.employee.findUnique({
      where: { id: user.id },
      select: {
        isDesignHead: true,
        isRdHead: true,
        vertical: { select: { code: true } },
      },
    });
    if (
      employee?.isDesignHead ||
      employee?.isRdHead ||
      ['DESIGN', 'RND'].includes(employee?.vertical?.code ?? '')
    ) {
      return;
    }
    throw new ForbiddenException(
      'Only Design or R&D staff may submit Design for review',
    );
  }

  async assertInternalAuditor(user: AuthenticatedUser): Promise<void> {
    if (user.role === Role.SUPER_ADMIN) return;
    const employee = await this.prisma.employee.findUnique({
      where: { id: user.id },
      select: { isInternalAuditor: true },
    });
    if (employee?.isInternalAuditor) return;
    throw new ForbiddenException(
      'Only an Internal Auditor or SUPER_ADMIN may record a vendor site-visit update',
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
              attendees: { where: { employeeId: user.id }, select: { id: true } },
            },
          },
        },
      }),
      this.prisma.employee.findUnique({
        where: { id: user.id },
        select: { isProductionHead: true, isInternalAuditor: true },
      }),
    ]);
    if (
      tracker &&
      (tracker.ownerId === user.id ||
        tracker.order.ownerId === user.id ||
        tracker.kickoff.attendees.length > 0 ||
        employee?.isProductionHead ||
        employee?.isInternalAuditor)
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
      select: { isProductionHead: true, isInternalAuditor: true },
    });
    if (employee?.isProductionHead || employee?.isInternalAuditor) return;
    throw new ForbiddenException('You are not involved in this order’s PLM work');
  }
}
