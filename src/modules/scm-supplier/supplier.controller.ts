import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
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
import { SupplierService } from './supplier.service';
import {
  CreateAuditDto,
  CreateInviteDto,
  CreateSupplierDto,
  PublicCertConfirmDto,
  PublicCertUploadUrlDto,
  PublicQuestionnaireSaveDto,
} from './dto/supplier.dto';

/**
 * Supplier Qualification (SCM raw materials) — authenticated surface. Distinct
 * from Vendor Qualification's /vendors. Company-wide read; create/invite is
 * SCM-Manager+/SA; audit is Internal Auditor/SA — enforced in
 * SupplierAccessService.
 */
@ApiTags('scm-supplier')
@ApiBearerAuth()
@UseGuards(RolesGuard)
@Roles(Role.MANAGER, Role.EMPLOYEE, Role.ADMIN, Role.SUPER_ADMIN)
@Controller('suppliers')
export class SupplierController {
  constructor(private readonly service: SupplierService) {}

  @Post()
  @ApiOperation({ summary: 'Create a supplier + first questionnaire (SCM Manager+/SA)' })
  createSupplier(
    @Body() dto: CreateSupplierDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.createSupplier(dto, user);
  }

  @Get()
  @ApiOperation({ summary: 'List suppliers (company-wide read)' })
  listSuppliers() {
    return this.service.listSuppliers();
  }

  @Get(':id')
  @ApiOperation({ summary: 'One supplier with questionnaires + audits (company-wide read)' })
  getSupplier(@Param('id') id: string) {
    return this.service.getSupplier(id);
  }

  @Post(':id/questionnaires')
  @ApiOperation({ summary: 'Create the next questionnaire revision (SCM Manager+/SA)' })
  createQuestionnaireRevision(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.createQuestionnaireRevision(id, user);
  }

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

  // ── Internal fill (second path to SUBMITTED) ─────────────────────────
  // SCM staff fill the same questionnaire directly in-app. Every field is
  // optional. Same access as invite management (SCM Manager+/SA).
  @Post('questionnaires/:questionnaireId/internal-fill/save')
  @ApiOperation({ summary: 'Save internal-fill section data — all fields optional (SCM Manager+/SA)' })
  saveInternal(
    @Param('questionnaireId') questionnaireId: string,
    @Body() dto: PublicQuestionnaireSaveDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.saveInternal(questionnaireId, dto, user);
  }

  @Post('questionnaires/:questionnaireId/internal-fill/submit')
  @ApiOperation({
    summary:
      'Mark internally-filled questionnaire as submitted (filledBy=INTERNAL_STAFF) (SCM Manager+/SA)',
  })
  submitInternal(
    @Param('questionnaireId') questionnaireId: string,
    @Body() dto: PublicQuestionnaireSaveDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.submitInternal(questionnaireId, dto, user);
  }

  @Post('questionnaires/:questionnaireId/internal-fill/certificate-upload-url')
  @ApiOperation({ summary: 'Presign a certificate upload for internal fill (SCM Manager+/SA)' })
  internalCertUploadUrl(
    @Param('questionnaireId') questionnaireId: string,
    @Body() dto: PublicCertUploadUrlDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.internalCertUploadUrl(questionnaireId, dto, user);
  }

  @Post('questionnaires/:questionnaireId/internal-fill/certificate-confirm')
  @ApiOperation({ summary: 'Confirm a certificate upload for internal fill (SCM Manager+/SA)' })
  internalCertConfirm(
    @Param('questionnaireId') questionnaireId: string,
    @Body() dto: PublicCertConfirmDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.internalCertConfirm(questionnaireId, dto, user);
  }

  @Post(':id/audits')
  @ApiOperation({
    summary:
      'Create + finalize an audit; sets supplier status to the computed classification (Internal Auditor/SA)',
  })
  createAudit(
    @Param('id') id: string,
    @Body() dto: CreateAuditDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.createAudit(id, dto, user);
  }
}
