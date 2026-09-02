import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import {
  AuthenticatedUser,
  CurrentUser,
} from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { CandidateRequisitionsService } from './candidate-requisitions.service';
import {
  CreateCandidateRequisitionDto,
  RejectCandidateRequisitionDto,
  UpdateCandidateHiringLifecycleDto,
} from './dto/candidate-requisition.dto';

@ApiTags('candidate-requisitions')
@ApiBearerAuth()
@Controller('candidate-requisitions')
@Roles(Role.MANAGER, Role.ADMIN, Role.SUPER_ADMIN)
export class CandidateRequisitionsController {
  constructor(private readonly service: CandidateRequisitionsService) {}
  @Post() create(
    @Body() dto: CreateCandidateRequisitionDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.create(dto, user);
  }
  @Get('mine') mine(@CurrentUser() user: AuthenticatedUser) {
    return this.service.listMine(user);
  }
  @Get('register')
  @Roles(Role.EMPLOYEE, Role.MANAGER, Role.ADMIN, Role.SUPER_ADMIN)
  register(@CurrentUser() user: AuthenticatedUser) {
    return this.service.listRegister(user);
  }
  @Get('onboarding-options')
  @Roles(Role.EMPLOYEE, Role.MANAGER, Role.ADMIN, Role.SUPER_ADMIN)
  onboardingOptions(@CurrentUser() user: AuthenticatedUser) {
    return this.service.listOnboardingOptions(user);
  }
  @Get('pending-vertical')
  @Roles(Role.EMPLOYEE, Role.MANAGER, Role.ADMIN, Role.SUPER_ADMIN)
  verticalQueue(@CurrentUser() user: AuthenticatedUser) {
    return this.service.listVerticalPending(user);
  }
  @Get('pending-superadmin') superAdminQueue(
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.listSuperAdminPending(user);
  }
  @Post(':id/vertical-approve')
  @Roles(Role.EMPLOYEE, Role.MANAGER, Role.ADMIN, Role.SUPER_ADMIN)
  verticalApprove(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.approveVertical(id, user);
  }
  @Post(':id/vertical-reject')
  @Roles(Role.EMPLOYEE, Role.MANAGER, Role.ADMIN, Role.SUPER_ADMIN)
  verticalReject(
    @Param('id') id: string,
    @Body() dto: RejectCandidateRequisitionDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.rejectVertical(id, dto.comment, user);
  }
  @Post(':id/superadmin-approve') superAdminApprove(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.approveSuperAdmin(id, user);
  }
  @Post(':id/superadmin-reject') superAdminReject(
    @Param('id') id: string,
    @Body() dto: RejectCandidateRequisitionDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.rejectSuperAdmin(id, dto.comment, user);
  }
  @Post(':id/cancel') cancel(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.cancel(id, user);
  }
  @Patch(':id/hiring-lifecycle')
  @Roles(Role.EMPLOYEE, Role.MANAGER, Role.ADMIN, Role.SUPER_ADMIN)
  updateHiringLifecycle(
    @Param('id') id: string,
    @Body() dto: UpdateCandidateHiringLifecycleDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.updateHiringLifecycle(id, dto, user);
  }
}
