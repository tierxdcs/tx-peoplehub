import { ForbiddenException, Injectable } from '@nestjs/common';
import { Role } from '@prisma/client';
import { PrismaService } from '../../core/database/prisma.service';
import { AuthenticatedUser } from '../../common/decorators/current-user.decorator';

/**
 * Access rules for the Vendor Qualification (SCM) module:
 *
 *  - READ (vendor list/detail): company-wide — any authenticated employee.
 *    Useful for Production/Procurement/Sales sourcing decisions. No gate here
 *    beyond authentication, so there's no assert for reads.
 *  - CREATE vendor / send questionnaire invite: SCM-vertical MANAGER (i.e.
 *    Manager-or-above in the SCM vertical) or SUPER_ADMIN. Plain ADMIN excluded
 *    (account-management-only, like the Sales module).
 *  - CONDUCT/FINALIZE audit: Internal Auditor (Employee.isInternalAuditor) or
 *    SUPER_ADMIN.
 */
@Injectable()
export class ScmAccessService {
  constructor(private readonly prisma: PrismaService) {}

  isSuperAdmin(user: AuthenticatedUser): boolean {
    return user.role === Role.SUPER_ADMIN;
  }

  /** SCM-vertical staff at MANAGER level (Manager-or-above in the SCM vertical). */
  private async isScmManager(user: AuthenticatedUser): Promise<boolean> {
    // "Manager or above" within SCM: a MANAGER whose vertical is SCM. (ADMIN is
    // account-mgmt-only; SUPER_ADMIN is handled by the isSuperAdmin override.)
    if (user.role !== Role.MANAGER) return false;
    if (!user.verticalId) return false;
    const vertical = await this.prisma.vertical.findUnique({
      where: { id: user.verticalId },
    });
    return vertical?.code === 'SCM';
  }

  /** Create vendor / send invite — SCM Manager+ or SUPER_ADMIN. */
  async assertCanManageVendors(user: AuthenticatedUser): Promise<void> {
    if (this.isSuperAdmin(user)) return;
    if (!(await this.isScmManager(user))) {
      throw new ForbiddenException(
        'Only an SCM-vertical Manager or SUPER_ADMIN may manage vendors',
      );
    }
  }

  /** Internal Auditor capability: SUPER_ADMIN always, or the flag. */
  async isInternalAuditor(user: AuthenticatedUser): Promise<boolean> {
    if (this.isSuperAdmin(user)) return true;
    const me = await this.prisma.employee.findUnique({
      where: { id: user.id },
      select: { isInternalAuditor: true },
    });
    return !!me?.isInternalAuditor;
  }

  /** Conduct/finalize an audit — Internal Auditor or SUPER_ADMIN. */
  async assertCanAudit(user: AuthenticatedUser): Promise<void> {
    if (!(await this.isInternalAuditor(user))) {
      throw new ForbiddenException(
        'Only an Internal Auditor or SUPER_ADMIN may conduct vendor audits',
      );
    }
  }
}
