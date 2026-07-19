import { ForbiddenException, Injectable } from '@nestjs/common';
import { EmployeeStatus, Role } from '@prisma/client';
import { PrismaService } from '../../core/database/prisma.service';
import { AuthenticatedUser } from '../../common/decorators/current-user.decorator';

/**
 * Access rules for Logistics & Dispatch:
 *  - READ: company-wide (Sales wants to see whether a customer's order shipped).
 *  - CREATE / dispatch / POD: active Production-vertical employee (Stores /
 *    Logistics) or SUPER_ADMIN — same model as the inbound Stores flow.
 *  - Outbound final-QC clearance: a designated QC Inspector (isQcInspector) or
 *    SUPER_ADMIN — mirrors the inbound GRN QC authority.
 */
@Injectable()
export class DispatchAccessService {
  constructor(private readonly prisma: PrismaService) {}

  isSuperAdmin(user: AuthenticatedUser): boolean {
    return user.role === Role.SUPER_ADMIN;
  }

  private async load(user: AuthenticatedUser): Promise<{
    status: EmployeeStatus;
    isQcInspector: boolean;
    verticalCode: string | null;
  } | null> {
    const emp = await this.prisma.employee.findUnique({
      where: { id: user.id },
      select: {
        status: true,
        isQcInspector: true,
        vertical: { select: { code: true } },
      },
    });
    if (!emp) return null;
    return {
      status: emp.status,
      isQcInspector: emp.isQcInspector,
      verticalCode: emp.vertical?.code ?? null,
    };
  }

  /** Create / dispatch a DC, capture POD — Production-vertical or SUPER_ADMIN. */
  async assertCanDispatch(user: AuthenticatedUser): Promise<void> {
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
      'Only an active Production-vertical employee or SUPER_ADMIN may create or dispatch delivery challans',
    );
  }

  /** Clear outbound final QC — designated QC Inspector or SUPER_ADMIN. */
  async assertCanClearFinalQc(user: AuthenticatedUser): Promise<void> {
    if (this.isSuperAdmin(user)) return;
    const emp = await this.load(user);
    if (emp && emp.status === EmployeeStatus.ACTIVE && emp.isQcInspector) {
      return;
    }
    throw new ForbiddenException(
      'Only a designated QC Inspector or SUPER_ADMIN may clear outbound final QC',
    );
  }
}
