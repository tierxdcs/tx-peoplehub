import { ForbiddenException, Injectable } from '@nestjs/common';
import { PrismaService } from '../../core/database/prisma.service';
import { Role } from '@prisma/client';
import { AuthenticatedUser } from '../../common/decorators/current-user.decorator';

/**
 * THE gate for the whole Executive Dashboards section — Sales today, Finance /
 * Production later. Every dashboard in the section calls this same service
 * rather than inventing its own check, so granting access once grants the
 * section, and a new dashboard is a new controller route, not a new permission.
 *
 * Access is `Employee.hasExecutiveDashboardAccess`, a discretionary CEO grant.
 * It is deliberately NOT derived from vertical, role, designation or seniority:
 * a Sales-vertical employee who holds it sees the cost and margin figures the
 * Sales vertical is otherwise denied, because that disclosure is the purpose of
 * the grant. SUPER_ADMIN (the CEO) is an implicit holder — they administer the
 * flag, so requiring them to grant it to themselves would be busywork.
 */
@Injectable()
export class ExecutiveAccessService {
  constructor(private readonly prisma: PrismaService) {}

  async hasAccess(user: AuthenticatedUser): Promise<boolean> {
    if (user.role === Role.SUPER_ADMIN) return true;
    const employee = await this.prisma.employee.findUnique({
      where: { id: user.id },
      select: { status: true, hasExecutiveDashboardAccess: true },
    });
    return (
      employee?.status === 'ACTIVE' &&
      employee.hasExecutiveDashboardAccess === true
    );
  }

  async assertAccess(user: AuthenticatedUser): Promise<void> {
    if (await this.hasAccess(user)) return;
    throw new ForbiddenException(
      'Executive Dashboards access has not been granted',
    );
  }
}
