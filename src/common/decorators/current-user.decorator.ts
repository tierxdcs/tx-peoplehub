import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { Role } from '@prisma/client';

export interface AuthenticatedUser {
  id: string;
  email: string;
  // Always set for a valid token (login/refresh reject employees whose role
  // hasn't been assigned yet), but typed nullable since Employee.role is
  // nullable at the DB level during PENDING_ACCESS.
  role: Role | null;
  verticalId: string | null;
  /**
   * True when an admin force-reset requires this user to set a new password
   * before doing anything else. Set by JwtStrategy from the live employee
   * record; enforced by MustChangePasswordGuard. Optional for callers that
   * don't consult it.
   */
  mustChangePassword?: boolean;
}

/**
 * Injects the authenticated user (set on the request by JwtStrategy) into a
 * controller handler: `@CurrentUser() user: AuthenticatedUser`.
 */
export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthenticatedUser => {
    const request = ctx.switchToHttp().getRequest();
    return request.user;
  },
);
