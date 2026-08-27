import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import {
  AuthenticatedUser,
  CurrentUser,
} from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { ProvisioningDecisionDto } from './dto/provisioning-decision.dto';
import {
  CreateProvisioningItemTypeDto,
  UpdateProvisioningItemTypeDto,
} from './dto/provisioning-item-type.dto';
import { ProvisioningService } from './provisioning.service';

@ApiTags('provisioning')
@ApiBearerAuth()
@Controller('provisioning')
@Roles(Role.EMPLOYEE, Role.MANAGER, Role.ADMIN, Role.SUPER_ADMIN)
export class ProvisioningController {
  constructor(private readonly service: ProvisioningService) {}

  @Get('item-types')
  listItemTypes(@CurrentUser() user: AuthenticatedUser) {
    return this.service.listItemTypes(user);
  }
  @Post('item-types')
  createItemType(
    @Body() dto: CreateProvisioningItemTypeDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.createItemType(dto, user);
  }
  @Patch('item-types/:id')
  updateItemType(
    @Param('id') id: string,
    @Body() dto: UpdateProvisioningItemTypeDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.updateItemType(id, dto, user);
  }

  @Get('pending-approval')
  listPending(@CurrentUser() user: AuthenticatedUser) {
    return this.service.listPending(user);
  }
  @Get('scm-queue')
  listScmQueue(@CurrentUser() user: AuthenticatedUser) {
    return this.service.listScmQueue(user);
  }
  @Get('employee/:employeeId')
  listForEmployee(
    @Param('employeeId') employeeId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.listForEmployee(employeeId, user);
  }

  @Post('requests/:id/approve')
  approve(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.service.approve(id, user);
  }
  @Post('requests/:id/reject')
  reject(
    @Param('id') id: string,
    @Body() dto: ProvisioningDecisionDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.reject(id, dto.comment, user);
  }
  @Post('requests/:id/fulfill')
  fulfill(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.service.fulfill(id, user);
  }
}
