import { ForbiddenException, Injectable } from '@nestjs/common';
import { EmployeeStatus, LogisticsAccessLevel, Role } from '@prisma/client';
import { PrismaService } from '../../core/database/prisma.service';
import { AuthenticatedUser } from '../../common/decorators/current-user.decorator';

type DispatchEmployeeAccess = {
  status: EmployeeStatus;
  isQcInspector: boolean;
  verticalCode: string | null;
  logisticsAccessLevel: LogisticsAccessLevel | null;
  logisticsAccessStartsAt: Date | null;
  logisticsAccessExpiresAt: Date | null;
  logisticsAccessRevokedAt: Date | null;
};

/**
 * Access rules for Logistics & Dispatch:
 *  - READ: company-wide (Sales wants to see whether a customer's order shipped).
 *  - CREATE / dispatch / POD: active Production-vertical employee (Stores /
 *    Logistics), designated QC Inspector, or SUPER_ADMIN.
 *  - Outbound final-QC clearance: a designated QC Inspector (isQcInspector) or
 *    SUPER_ADMIN — mirrors the inbound GRN QC authority.
 */
@Injectable()
export class DispatchAccessService {
  constructor(private readonly prisma: PrismaService) {}

  isSuperAdmin(user: AuthenticatedUser): boolean {
    return user.role === Role.SUPER_ADMIN;
  }

  private async load(
    user: AuthenticatedUser,
  ): Promise<DispatchEmployeeAccess | null> {
    const emp = await this.prisma.employee.findUnique({
      where: { id: user.id },
      select: {
        status: true,
        isQcInspector: true,
        logisticsAccessLevel: true,
        logisticsAccessStartsAt: true,
        logisticsAccessExpiresAt: true,
        logisticsAccessRevokedAt: true,
        vertical: { select: { code: true } },
      },
    });
    if (!emp) return null;
    return {
      status: emp.status,
      isQcInspector: emp.isQcInspector,
      verticalCode: emp.vertical?.code ?? null,
      logisticsAccessLevel: emp.logisticsAccessLevel,
      logisticsAccessStartsAt: emp.logisticsAccessStartsAt,
      logisticsAccessExpiresAt: emp.logisticsAccessExpiresAt,
      logisticsAccessRevokedAt: emp.logisticsAccessRevokedAt,
    };
  }

  private activeGrant(emp: DispatchEmployeeAccess) {
    const now = new Date();
    if (
      emp.status !== EmployeeStatus.ACTIVE ||
      emp.logisticsAccessRevokedAt ||
      !emp.logisticsAccessLevel ||
      !emp.logisticsAccessStartsAt ||
      !emp.logisticsAccessExpiresAt ||
      emp.logisticsAccessStartsAt > now ||
      emp.logisticsAccessExpiresAt <= now
    ) {
      return null;
    }
    return emp.logisticsAccessLevel;
  }

  async currentAccess(user: AuthenticatedUser) {
    if (this.isSuperAdmin(user)) {
      return { level: LogisticsAccessLevel.OPERATE, expiresAt: null };
    }
    const emp = await this.load(user);
    if (!emp) return { level: null, expiresAt: null };
    const native = emp.verticalCode === 'PRODUCTION' || emp.isQcInspector;
    const level = native ? LogisticsAccessLevel.OPERATE : this.activeGrant(emp);
    return { level, expiresAt: native ? null : emp.logisticsAccessExpiresAt };
  }

  /** Create / dispatch a DC, capture POD — Production, QC Inspector, or admin. */
  async assertCanDispatch(user: AuthenticatedUser): Promise<void> {
    if (this.isSuperAdmin(user)) return;
    const emp = await this.load(user);
    if (
      emp &&
      emp.status === EmployeeStatus.ACTIVE &&
      (emp.verticalCode === 'PRODUCTION' ||
        emp.isQcInspector ||
        this.activeGrant(emp) === LogisticsAccessLevel.OPERATE)
    ) {
      return;
    }
    throw new ForbiddenException(
      'Only an active Logistics Operator, Production employee, designated QC Inspector, or SUPER_ADMIN may create or dispatch delivery challans',
    );
  }

  /** Read dispatch-ready projects without granting challan write access. */
  async assertCanViewDispatchOrders(user: AuthenticatedUser): Promise<void> {
    if (this.isSuperAdmin(user)) return;
    const emp = await this.load(user);
    if (
      emp &&
      emp.status === EmployeeStatus.ACTIVE &&
      (emp.isQcInspector ||
        emp.verticalCode === 'QUALITY' ||
        emp.verticalCode === 'PRODUCTION' ||
        this.activeGrant(emp) === LogisticsAccessLevel.OPERATE)
    ) {
      return;
    }
    throw new ForbiddenException(
      'Only active Quality, QC Inspector, Production, or SUPER_ADMIN users may view dispatch-ready orders',
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
