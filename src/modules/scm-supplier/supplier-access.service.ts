import { ForbiddenException, Injectable } from '@nestjs/common';
import { Role } from '@prisma/client';
import { PrismaService } from '../../core/database/prisma.service';
import { AuthenticatedUser } from '../../common/decorators/current-user.decorator';

/**
 * Access rules for Supplier Qualification — identical policy to Vendor
 * Qualification: company-wide read (no assert), SCM-vertical Manager+ / SA to
 * create/invite, Internal Auditor / SA to audit (reuses isInternalAuditor).
 */
@Injectable()
export class SupplierAccessService {
  constructor(private readonly prisma: PrismaService) {}

  isSuperAdmin(user: AuthenticatedUser): boolean {
    return user.role === Role.SUPER_ADMIN;
  }

  private async isScmManager(user: AuthenticatedUser): Promise<boolean> {
    if (user.role !== Role.MANAGER) return false;
    if (!user.verticalId) return false;
    const vertical = await this.prisma.vertical.findUnique({
      where: { id: user.verticalId },
    });
    return vertical?.code === 'SCM';
  }

  async assertCanManageSuppliers(user: AuthenticatedUser): Promise<void> {
    if (this.isSuperAdmin(user)) return;
    if (!(await this.isScmManager(user))) {
      throw new ForbiddenException(
        'Only an SCM-vertical Manager or SUPER_ADMIN may manage suppliers',
      );
    }
  }

  async isInternalAuditor(user: AuthenticatedUser): Promise<boolean> {
    if (this.isSuperAdmin(user)) return true;
    const me = await this.prisma.employee.findUnique({
      where: { id: user.id },
      select: { isInternalAuditor: true },
    });
    return !!me?.isInternalAuditor;
  }

  async assertCanAudit(user: AuthenticatedUser): Promise<void> {
    if (!(await this.isInternalAuditor(user))) {
      throw new ForbiddenException(
        'Only an Internal Auditor or SUPER_ADMIN may conduct supplier audits',
      );
    }
  }
}
