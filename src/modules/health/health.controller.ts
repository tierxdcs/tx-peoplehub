import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import {
  AuthenticatedUser,
  CurrentUser,
} from '../../common/decorators/current-user.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { RolesGuard } from '../../common/guards/roles.guard';
import { PrismaService } from '../../core/database/prisma.service';
import { EmailService } from '../../core/email/email.service';
import { renderEmailLayout } from '../../core/email/email-content';
import { EmailTestDto } from './dto/email-test.dto';

@ApiTags('health')
@Controller('health')
export class HealthController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly email: EmailService,
  ) {}

  @Public()
  @Get()
  @ApiOperation({ summary: 'Liveness + DB connectivity check' })
  async check() {
    let db = 'up';
    try {
      await this.prisma.$queryRaw`SELECT 1`;
    } catch {
      db = 'down';
    }
    return { status: db === 'up' ? 'ok' : 'degraded', db };
  }

  /**
   * Proves the *deployed* service's own email wiring: that RESEND_API_KEY
   * reached this container and that the sending domain's SPF/DKIM records are
   * verified at the provider. A laptop-run script can't tell you either.
   * Never returns the key itself.
   */
  @ApiBearerAuth()
  @UseGuards(RolesGuard)
  @Roles(Role.SUPER_ADMIN)
  @Get('email')
  @ApiOperation({ summary: 'Email configuration + sending-domain DNS status' })
  async emailStatus() {
    const base = {
      configured: this.email.isConfigured(),
      from: this.email.fromAddress ?? null,
      dryRun: this.email.dryRun,
      allowedRecipients: this.email.allowedRecipients,
    };
    if (!base.configured) {
      return { ...base, domains: [], error: null };
    }
    try {
      return {
        ...base,
        domains: await this.email.describeDomains(),
        error: null,
      };
    } catch (err) {
      // A bad key or provider outage shouldn't 500 a diagnostics route — the
      // message is the diagnosis.
      return {
        ...base,
        domains: [],
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  @ApiBearerAuth()
  @UseGuards(RolesGuard)
  @Roles(Role.SUPER_ADMIN)
  @Post('email-test')
  @ApiOperation({
    summary: 'Send a test email through the shared EmailService',
  })
  async emailTest(
    @Body() dto: EmailTestDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    const html = renderEmailLayout({
      heading: 'Email is working',
      paragraphs: [
        'This is a test message from tx-peoplehub, sent through the shared EmailService.',
        `Requested by ${user.email}.`,
        ...(dto.note ? [dto.note] : []),
      ],
      footnote:
        'No feature sends email automatically yet — this only confirms the sending setup.',
    });
    // Strict send: the request IS the send, so a failure must surface.
    return this.email.send({
      to: dto.to,
      subject: 'tx-peoplehub email test',
      html,
      tags: [{ name: 'kind', value: 'email-test' }],
    });
  }
}
