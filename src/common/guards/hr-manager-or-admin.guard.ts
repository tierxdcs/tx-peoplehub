import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Role } from '@prisma/client';
import { PrismaService } from '../../core/database/prisma.service';
import { AuthenticatedUser } from '../decorators/current-user.decorator';

/**
 * Allows ADMIN / SUPER_ADMIN, OR an HR-vertical MANAGER. Used on the People /
 * Leave & Attendance / Payroll admin endpoints so HR leads can run those
 * functions without granting company-wide admin — while Payroll (salary/PII)
 * stays limited to HR MANAGERS, not every HR employee.
 *
 * This "role OR (role + vertical)" rule can't be expressed by the static
 * @Roles decorator (which only checks the role enum), so it lives in a guard
 * that resolves the caller's vertical code. Runs after JwtAuthGuard, so
 * request.user is populated.
 */
@Injectable()
export class HrManagerOrAdminGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const { user } = context.switchToHttp().getRequest<{
      user?: AuthenticatedUser;
    }>();
    if (!user) {
      throw new ForbiddenException('Insufficient role');
    }
    if (user.role === Role.ADMIN || user.role === Role.SUPER_ADMIN) {
      return true;
    }
    // Otherwise: only an HR-vertical MANAGER qualifies.
    if (user.role === Role.MANAGER && user.verticalId) {
      const vertical = await this.prisma.vertical.findUnique({
        where: { id: user.verticalId },
        select: { code: true },
      });
      if (vertical?.code === 'HR') {
        return true;
      }
    }
    throw new ForbiddenException(
      'Only Admins or HR Managers may perform this action',
    );
  }
}
