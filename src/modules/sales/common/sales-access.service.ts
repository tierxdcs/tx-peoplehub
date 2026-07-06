import { ForbiddenException, Injectable } from '@nestjs/common';
import { Role } from '@prisma/client';
import { PrismaService } from '../../../core/database/prisma.service';
import { AuthenticatedUser } from '../../../common/decorators/current-user.decorator';
import { EmployeesService } from '../../employees/employees.service';

export function isAdmin(user: AuthenticatedUser): boolean {
  return user.role === Role.ADMIN || user.role === Role.SUPER_ADMIN;
}

export function isSuperAdmin(user: AuthenticatedUser): boolean {
  return user.role === Role.SUPER_ADMIN;
}

/**
 * Central access rules for the Sales module. Two orthogonal concerns:
 *
 * 1. Module entry (`assertSalesAccess`): only SALES-vertical employees plus
 *    SUPER_ADMIN reach Sales operational data. Plain ADMIN is deliberately
 *    excluded — consistent with the Employee module's rule that Admin is
 *    account-management-only with no operational-data visibility. (This is
 *    enforced here in the service layer, since RolesGuard alone can't
 *    express "MANAGER/EMPLOYEE only if in the SALES vertical".)
 *
 * 2. READ visibility is vertical-wide: any Sales-vertical EMPLOYEE/MANAGER
 *    (and SUPER_ADMIN) may view ALL Sales records — `assertSalesAccess`
 *    already gates who reaches these endpoints, so list/detail reads apply
 *    no owner filter. See `assertCanReadRecord` (a no-op past the module
 *    gate) and the list endpoints which drop the ownerId filter entirely.
 *
 * 3. WRITE visibility is still owner/hierarchy-scoped: `visibleOwnerIds` and
 *    `assertCanAccessOwned` remain the guards for MUTATIONS (edit a DRAFT,
 *    submit, convert, change status) — an EMPLOYEE may act only on their own
 *    records; a MANAGER on their own + downstream team's; SUPER_ADMIN on
 *    anything. Broadening read access deliberately did NOT touch these.
 */
@Injectable()
export class SalesAccessService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly employeesService: EmployeesService,
  ) {}

  /** SALES-vertical MANAGER/EMPLOYEE, or SUPER_ADMIN. Throws otherwise. */
  async assertSalesAccess(user: AuthenticatedUser): Promise<void> {
    if (isSuperAdmin(user)) {
      return;
    }
    if (!(await this.isSalesStaff(user))) {
      throw new ForbiddenException(
        'Only Sales-vertical staff may access the Sales module',
      );
    }
  }

  /** Sales staff = MANAGER/EMPLOYEE whose vertical is the one coded 'SALES'. */
  async isSalesStaff(user: AuthenticatedUser): Promise<boolean> {
    if (user.role !== Role.MANAGER && user.role !== Role.EMPLOYEE) {
      return false;
    }
    if (!user.verticalId) {
      return false;
    }
    const vertical = await this.prisma.vertical.findUnique({
      where: { id: user.verticalId },
    });
    return vertical?.code === 'SALES';
  }

  /**
   * WRITE scope — the set of `ownerId`s this user may MUTATE records for, or
   * `null` meaning "no ownership restriction" (SUPER_ADMIN). NOT used for
   * reads (reads are vertical-wide). Use for a mutation-guard where clause or
   * via `assertCanAccessOwned`.
   *
   * EMPLOYEE  -> [self]
   * MANAGER   -> [self, ...downstream team (direct + indirect)]
   * SUPER_ADMIN -> null
   */
  async visibleOwnerIds(user: AuthenticatedUser): Promise<string[] | null> {
    if (isSuperAdmin(user)) {
      return null;
    }
    if (user.role === Role.MANAGER) {
      const team = await this.employeesService.getTeam(user.id, user);
      return [user.id, ...team.map((e) => e.id)];
    }
    // EMPLOYEE (and any other non-super-admin) sees only their own.
    return [user.id];
  }

  /**
   * WRITE guard — assert the user may MUTATE a record with the given
   * ownerId. SUPER_ADMIN always passes; others must own it or have it in
   * their downstream team. Reads do NOT use this (reads are vertical-wide).
   */
  async assertCanAccessOwned(
    user: AuthenticatedUser,
    ownerId: string,
  ): Promise<void> {
    const ids = await this.visibleOwnerIds(user);
    if (ids === null) {
      return;
    }
    if (!ids.includes(ownerId)) {
      throw new ForbiddenException(
        'This record belongs to another Sales rep outside your team',
      );
    }
  }
}
