import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import {
  AuthenticatedUser,
  CurrentUser,
} from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { RolesGuard } from '../../common/guards/roles.guard';
import { ScmService } from './scm.service';
import {
  CreateAuditDto,
  CreateInviteDto,
  CreateVendorDto,
} from './dto/scm.dto';

/**
 * Vendor Qualification (SCM) — authenticated surface. Vendor list/detail is
 * company-wide read; create/invite is SCM-Manager+/SA; audit is Internal
 * Auditor/SA. The fine gating lives in ScmAccessService (RolesGuard can't
 * express "SCM-vertical Manager" or "internal auditor"), so the class guard is
 * coarse — every operational role reaches the routes, service asserts the rest.
 */
@ApiTags('scm')
@ApiBearerAuth()
@UseGuards(RolesGuard)
@Roles(Role.MANAGER, Role.EMPLOYEE, Role.ADMIN, Role.SUPER_ADMIN)
@Controller('vendors')
export class ScmController {
  constructor(private readonly service: ScmService) {}

  // ── Vendors ──────────────────────────────────────────────────────
  @Post()
  @ApiOperation({ summary: 'Create a vendor + first questionnaire (SCM Manager+/SA)' })
  createVendor(
    @Body() dto: CreateVendorDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.createVendor(dto, user);
  }

  @Get()
  @ApiOperation({ summary: 'List vendors (company-wide read)' })
  listVendors() {
    return this.service.listVendors();
  }

  @Get(':id')
  @ApiOperation({ summary: 'One vendor with questionnaires + audits (company-wide read)' })
  getVendor(@Param('id') id: string) {
    return this.service.getVendor(id);
  }

  // ── Questionnaire revisions ────────────────────────────────────────
  @Post(':id/questionnaires')
  @ApiOperation({
    summary: 'Create the next questionnaire revision for resubmission (SCM Manager+/SA)',
  })
  createQuestionnaireRevision(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.createQuestionnaireRevision(id, user);
  }

  // ── Invites ────────────────────────────────────────────────────────
  @Post('questionnaires/:questionnaireId/invites')
  @ApiOperation({ summary: 'Generate a public invite link (SCM Manager+/SA)' })
  createInvite(
    @Param('questionnaireId') questionnaireId: string,
    @Body() dto: CreateInviteDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.createInvite(questionnaireId, dto, user);
  }

  @Delete('invites/:inviteId')
  @HttpCode(204)
  @ApiOperation({ summary: 'Revoke a public invite link (SCM Manager+/SA)' })
  async revokeInvite(
    @Param('inviteId') inviteId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    await this.service.revokeInvite(inviteId, user);
  }

  // ── Audits ─────────────────────────────────────────────────────────
  @Post(':id/audits')
  @ApiOperation({
    summary:
      'Create + finalize an audit; sets vendor status to the computed classification (Internal Auditor/SA)',
  })
  createAudit(
    @Param('id') id: string,
    @Body() dto: CreateAuditDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.createAudit(id, dto, user);
  }
}
