import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { AuthenticatedUser, CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { CandidateRequisitionsService } from './candidate-requisitions.service';
import { CreateCandidateRequisitionDto, RejectCandidateRequisitionDto } from './dto/candidate-requisition.dto';

@ApiTags('candidate-requisitions') @ApiBearerAuth()
@Controller('candidate-requisitions')
@Roles(Role.MANAGER, Role.ADMIN, Role.SUPER_ADMIN)
export class CandidateRequisitionsController {
  constructor(private readonly service: CandidateRequisitionsService) {}
  @Post() create(@Body() dto: CreateCandidateRequisitionDto, @CurrentUser() user: AuthenticatedUser) { return this.service.create(dto, user); }
  @Get('mine') mine(@CurrentUser() user: AuthenticatedUser) { return this.service.listMine(user); }
  @Get('pending-vertical') @Roles(Role.EMPLOYEE, Role.MANAGER, Role.ADMIN, Role.SUPER_ADMIN)
  verticalQueue(@CurrentUser() user: AuthenticatedUser) { return this.service.listVerticalPending(user); }
  @Get('pending-superadmin') superAdminQueue(@CurrentUser() user: AuthenticatedUser) { return this.service.listSuperAdminPending(user); }
  @Get('available') available(@Query('employeeId') employeeId: string, @CurrentUser() user: AuthenticatedUser) { return this.service.availableForEmployee(employeeId, user); }
  @Post(':id/vertical-approve') @Roles(Role.EMPLOYEE, Role.MANAGER, Role.ADMIN, Role.SUPER_ADMIN)
  verticalApprove(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) { return this.service.approveVertical(id, user); }
  @Post(':id/vertical-reject') @Roles(Role.EMPLOYEE, Role.MANAGER, Role.ADMIN, Role.SUPER_ADMIN)
  verticalReject(@Param('id') id: string, @Body() dto: RejectCandidateRequisitionDto, @CurrentUser() user: AuthenticatedUser) { return this.service.rejectVertical(id, dto.comment, user); }
  @Post(':id/superadmin-approve') superAdminApprove(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) { return this.service.approveSuperAdmin(id, user); }
  @Post(':id/superadmin-reject') superAdminReject(@Param('id') id: string, @Body() dto: RejectCandidateRequisitionDto, @CurrentUser() user: AuthenticatedUser) { return this.service.rejectSuperAdmin(id, dto.comment, user); }
}
