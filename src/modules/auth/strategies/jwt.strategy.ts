import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { Role } from '@prisma/client';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { AuthenticatedUser } from '../../../common/decorators/current-user.decorator';
import { PrismaService } from '../../../core/database/prisma.service';

export interface JwtAccessPayload {
  sub: string;
  email: string;
  role: Role;
  verticalId: string | null;
  /**
   * The employee's tokenVersion at signing time. On every request the strategy
   * compares it against the CURRENT tokenVersion in the DB; a mismatch means the
   * token was invalidated (admin force-reset or self-service change bumped it),
   * so the session is rejected. Optional in the type for backward-compatibility
   * with any token issued before this field existed (treated as version 0).
   */
  tokenVersion?: number;
  /**
   * mustChangePassword at signing time — surfaced in the decoded token so the
   * frontend can route straight into the forced-change screen without an extra
   * API call. The guard still reads the LIVE flag from the DB (below) as the
   * authoritative enforcement point.
   */
  mustChangePassword?: boolean;
}

/**
 * Validates the bearer access token. Beyond signature/expiry (handled by
 * passport-jwt), this does a live check against the DB so that:
 *  - a stale tokenVersion (session invalidated by a reset/change) is rejected;
 *  - request.user carries the current mustChangePassword flag for the guard.
 */
@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, 'jwt') {
  constructor(
    config: ConfigService,
    private readonly prisma: PrismaService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: config.get<string>('jwt.accessSecret') as string,
    });
  }

  async validate(payload: JwtAccessPayload): Promise<AuthenticatedUser> {
    const employee = await this.prisma.employee.findUnique({
      where: { id: payload.sub },
      select: { tokenVersion: true, mustChangePassword: true },
    });
    if (!employee) {
      throw new UnauthorizedException('Invalid token');
    }
    // Reject tokens signed before the latest reset/change (session invalidated).
    if ((payload.tokenVersion ?? 0) !== employee.tokenVersion) {
      throw new UnauthorizedException('Session has been invalidated');
    }
    return {
      id: payload.sub,
      email: payload.email,
      role: payload.role,
      verticalId: payload.verticalId ?? null,
      mustChangePassword: employee.mustChangePassword,
    };
  }
}
