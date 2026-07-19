import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { ALLOW_DURING_FORCED_RESET_KEY } from '../decorators/allow-during-forced-reset.decorator';
import { AuthenticatedUser } from '../decorators/current-user.decorator';

/**
 * When an admin force-resets a password, the employee's `mustChangePassword`
 * flag is set. Until they resolve it (by changing their password), this guard
 * blocks EVERY authenticated route except:
 *  - @Public() routes (login/refresh — no user in context anyway), and
 *  - routes explicitly marked @AllowDuringForcedReset() (change-password, logout).
 *
 * Runs globally, after JwtAuthGuard (registration order in app.module), so
 * request.user is populated. A blocked request gets 403 with a clear code the
 * frontend keys off to route the user into the forced-change screen.
 */
@Injectable()
export class MustChangePasswordGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const allowed = this.reflector.getAllAndOverride<boolean>(
      ALLOW_DURING_FORCED_RESET_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (allowed) return true;

    const { user } = context.switchToHttp().getRequest<{
      user?: AuthenticatedUser;
    }>();
    if (user?.mustChangePassword) {
      throw new ForbiddenException({
        statusCode: 403,
        code: 'MUST_CHANGE_PASSWORD',
        message:
          'You must change your password before continuing. An administrator reset it.',
      });
    }
    return true;
  }
}
