import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import {
  AuthenticatedUser,
  CurrentUser,
} from '../../common/decorators/current-user.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { CandidateApplicationsService } from './candidate-applications.service';
import {
  CandidateApplicationResolveDto,
  CandidateResumeUploadUrlDto,
  CreateCandidateApplicationInviteDto,
  SubmitCandidateApplicationDto,
  UpdateCandidateApplicationStatusDto,
} from './dto/candidate-application.dto';

@ApiTags('candidate-applications')
@ApiBearerAuth()
@Controller('candidate-requisitions')
@Roles(Role.EMPLOYEE, Role.MANAGER, Role.ADMIN, Role.SUPER_ADMIN)
export class CandidateApplicationsController {
  constructor(private readonly service: CandidateApplicationsService) {}

  @Post(':id/application-links')
  createLink(
    @Param('id') id: string,
    @Body() dto: CreateCandidateApplicationInviteDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.createInvite(id, dto, user);
  }

  @Get(':id/application-links')
  listLinks(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.service.listInvites(id, user);
  }

  @Post('application-links/:linkId/revoke')
  revokeLink(
    @Param('linkId') linkId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.revokeInvite(linkId, user);
  }

  @Get(':id/applications')
  applications(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.listApplications(id, user);
  }

  @Patch('applications/:applicationId/status')
  updateStatus(
    @Param('applicationId') applicationId: string,
    @Body() dto: UpdateCandidateApplicationStatusDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.updateStatus(applicationId, dto.status, user);
  }

  @Get('applications/:applicationId/resume')
  resume(
    @Param('applicationId') applicationId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.resumeDownloadUrl(applicationId, user);
  }
}

@ApiTags('candidate-applications-public')
@Controller('public/job-applications')
export class CandidateApplicationsPublicController {
  constructor(private readonly service: CandidateApplicationsService) {}

  @Public()
  @Post(':token/resolve')
  resolve(
    @Param('token') token: string,
    @Body() dto: CandidateApplicationResolveDto,
  ) {
    return this.service.resolve(token, dto.password);
  }

  @Public()
  @Post(':token/resume-upload-url')
  resumeUpload(
    @Param('token') token: string,
    @Body() dto: CandidateResumeUploadUrlDto,
  ) {
    return this.service.createResumeUploadUrl(token, dto);
  }

  @Public()
  @Post(':token/submit')
  submit(
    @Param('token') token: string,
    @Body() dto: SubmitCandidateApplicationDto,
  ) {
    return this.service.submit(token, dto);
  }
}
