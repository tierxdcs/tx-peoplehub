import { ForbiddenException, Injectable } from '@nestjs/common';
import { Role } from '@prisma/client';
import { PrismaService } from '../../core/database/prisma.service';
import { AuthenticatedUser } from '../../common/decorators/current-user.decorator';

/**
 * Access rules for the RFQ Builder:
 *  - Manage (create/edit/issue/close): SCM-vertical Manager+ or SUPER_ADMIN
 *    (same rule as Purchase Orders).
 *  - Read: SCM-vertical staff or SUPER_ADMIN. NOTE the sealed-bid rule (quotes
 *    hidden until CLOSED) is enforced in the RFQ service, not here.
 *  - Award: an isProjectManager holder or SUPER_ADMIN (per spec §1).
 */
@Injectable()
export class RfqAccessService {
  constructor(private readonly prisma: PrismaService) {}

  isSuperAdmin(user: AuthenticatedUser): boolean {
    return user.role === Role.SUPER_ADMIN;
  }

  private async scmVertical(user: AuthenticatedUser): Promise<boolean> {
    if (!user.verticalId) return false;
    const v = await this.prisma.vertical.findUnique({
      where: { id: user.verticalId },
      select: { code: true },
    });
    return v?.code === 'SCM';
  }

  /** Read RFQs — SCM-vertical staff or SUPER_ADMIN. */
  async assertCanReadRfqs(user: AuthenticatedUser): Promise<void> {
    if (this.isSuperAdmin(user)) return;
    if (await this.scmVertical(user)) return;
    throw new ForbiddenException('Only SCM users may view RFQs');
  }

  /** Create/edit/issue/close — SCM-vertical Manager+ or SUPER_ADMIN. */
  async assertCanManageRfqs(user: AuthenticatedUser): Promise<void> {
    if (this.isSuperAdmin(user)) return;
    if (user.role === Role.MANAGER && (await this.scmVertical(user))) return;
    throw new ForbiddenException(
      'Only an SCM-vertical Manager or SUPER_ADMIN may manage RFQs',
    );
  }

  /** Award — an isProjectManager designation holder, or SUPER_ADMIN. */
  async assertCanAward(user: AuthenticatedUser): Promise<void> {
    if (this.isSuperAdmin(user)) return;
    const me = await this.prisma.employee.findUnique({
      where: { id: user.id },
      select: { isProjectManager: true },
    });
    if (me?.isProjectManager) return;
    throw new ForbiddenException(
      'Only a Project Manager or SUPER_ADMIN may award an RFQ',
    );
  }
}
