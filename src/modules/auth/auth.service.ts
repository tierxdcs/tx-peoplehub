import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { AccessStatus, EmployeeStatus, Role } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../../core/database/prisma.service';
import { JwtAccessPayload } from './strategies/jwt.strategy';

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
}

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
  ) {}

  /** Verify credentials and issue an access + refresh token pair. */
  async login(email: string, password: string): Promise<TokenPair> {
    const employee = await this.prisma.employee.findUnique({
      where: { email },
    });

    // A single generic error covers wrong password, deactivated employment,
    // and not-yet-activated access (PENDING_ACCESS has no passwordHash) —
    // deliberately not distinguishing these to avoid leaking which case
    // applies to a given email.
    if (
      !employee ||
      employee.status !== EmployeeStatus.ACTIVE ||
      employee.accessStatus !== AccessStatus.ACTIVE ||
      !employee.passwordHash ||
      !employee.role
    ) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const valid = await bcrypt.compare(password, employee.passwordHash);
    if (!valid) {
      throw new UnauthorizedException('Invalid credentials');
    }

    return this.issueTokens(
      employee.id,
      employee.email,
      employee.role,
      employee.verticalId,
    );
  }

  /** Validate a refresh token and issue a fresh token pair (rotation). */
  async refresh(refreshToken: string): Promise<TokenPair> {
    let payload: JwtAccessPayload;
    try {
      payload = await this.jwt.verifyAsync<JwtAccessPayload>(refreshToken, {
        secret: this.config.get<string>('jwt.refreshSecret'),
      });
    } catch {
      throw new UnauthorizedException('Invalid refresh token');
    }

    const employee = await this.prisma.employee.findUnique({
      where: { id: payload.sub },
    });
    if (
      !employee ||
      employee.status !== EmployeeStatus.ACTIVE ||
      employee.accessStatus !== AccessStatus.ACTIVE ||
      !employee.role
    ) {
      throw new UnauthorizedException('Invalid refresh token');
    }

    return this.issueTokens(
      employee.id,
      employee.email,
      employee.role,
      employee.verticalId,
    );
  }

  private async issueTokens(
    employeeId: string,
    email: string,
    role: Role,
    verticalId: string | null,
  ): Promise<TokenPair> {
    const payload: JwtAccessPayload = {
      sub: employeeId,
      email,
      role,
      verticalId,
    };

    const [accessToken, refreshToken] = await Promise.all([
      this.jwt.signAsync(payload, {
        secret: this.config.get<string>('jwt.accessSecret'),
        expiresIn: this.config.get<string>('jwt.accessTtl'),
      }),
      this.jwt.signAsync(payload, {
        secret: this.config.get<string>('jwt.refreshSecret'),
        expiresIn: this.config.get<string>('jwt.refreshTtl'),
      }),
    ]);

    return { accessToken, refreshToken };
  }
}
