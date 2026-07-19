import { ForbiddenException, Injectable } from '@nestjs/common';
import { EmployeeStatus, Role } from '@prisma/client';
import { PrismaService } from '../../core/database/prisma.service';
import { AuthenticatedUser } from '../../common/decorators/current-user.decorator';

/**
 * Access rules for the Goods Receipt + QC gate (Stores Phase 2):
 *
 *  - READ: company-wide (no assert), like Purchase Orders.
 *  - CREATE / edit a GRN: any active Production-vertical employee (goods are
 *    received on the shop floor), or SUPER_ADMIN.
 *  - QC inspection (finalize the QC gate): a designated QC Inspector
 *    (isQcInspector) or SUPER_ADMIN — SUPER_ADMIN is always implicitly a QC
 *    inspector, mirroring the other capability flags.
 *  - NCR disposition: a QC Inspector, a Production-vertical Manager+, or
 *    SUPER_ADMIN.
 */
@Injectable()
export class GrnAccessService {
  constructor(private readonly prisma: PrismaService) {}

  isSuperAdmin(user: AuthenticatedUser): boolean {
    return user.role === Role.SUPER_ADMIN;
  }

  private async load(user: AuthenticatedUser): Promise<{
    status: EmployeeStatus;
    role: Role | null;
    isQcInspector: boolean;
    verticalCode: string | null;
  } | null> {
    const emp = await this.prisma.employee.findUnique({
      where: { id: user.id },
      select: {
        status: true,
        role: true,
        isQcInspector: true,
        vertical: { select: { code: true } },
      },
    });
    if (!emp) return null;
    return {
      status: emp.status,
      role: emp.role,
      isQcInspector: emp.isQcInspector,
      verticalCode: emp.vertical?.code ?? null,
    };
  }

  /** Create / edit a GRN — active Production-vertical employee or SUPER_ADMIN. */
  async assertCanReceiveGoods(user: AuthenticatedUser): Promise<void> {
    if (this.isSuperAdmin(user)) return;
    const emp = await this.load(user);
    if (
      emp &&
      emp.status === EmployeeStatus.ACTIVE &&
      emp.verticalCode === 'PRODUCTION'
    ) {
      return;
    }
    throw new ForbiddenException(
      'Only an active Production-vertical employee or SUPER_ADMIN may receive goods',
    );
  }

  /** Finalize QC inspection — designated QC Inspector or SUPER_ADMIN. */
  async assertCanInspect(user: AuthenticatedUser): Promise<void> {
    if (this.isSuperAdmin(user)) return;
    const emp = await this.load(user);
    if (emp && emp.status === EmployeeStatus.ACTIVE && emp.isQcInspector) {
      return;
    }
    throw new ForbiddenException(
      'Only a designated QC Inspector or SUPER_ADMIN may perform QC inspection',
    );
  }

  /**
   * Disposition an NCR — a QC Inspector, a Production-vertical Manager+, or
   * SUPER_ADMIN.
   */
  async assertCanDispositionNcr(user: AuthenticatedUser): Promise<void> {
    if (this.isSuperAdmin(user)) return;
    const emp = await this.load(user);
    if (emp && emp.status === EmployeeStatus.ACTIVE) {
      if (emp.isQcInspector) return;
      const managerOrAbove =
        emp.role === Role.MANAGER ||
        emp.role === Role.ADMIN ||
        emp.role === Role.SUPER_ADMIN;
      if (managerOrAbove && emp.verticalCode === 'PRODUCTION') return;
    }
    throw new ForbiddenException(
      'Only a QC Inspector, a Production-vertical Manager or above, or SUPER_ADMIN may disposition an NCR',
    );
  }
}
