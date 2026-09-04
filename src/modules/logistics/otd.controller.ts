import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import {
  AuthenticatedUser,
  CurrentUser,
} from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { RolesGuard } from '../../common/guards/roles.guard';
import { OtdService } from './otd.service';
import { DispatchAccessService } from './dispatch-access.service';

@ApiTags('logistics-otd')
@ApiBearerAuth()
@UseGuards(RolesGuard)
@Roles(Role.MANAGER, Role.EMPLOYEE, Role.ADMIN, Role.SUPER_ADMIN)
@Controller('logistics/otd')
export class OtdController {
  constructor(
    private readonly otd: OtdService,
    private readonly access: DispatchAccessService,
  ) {}

  @Get('access')
  @ApiOperation({ summary: 'Current effective Logistics access' })
  accessForCurrentUser(@CurrentUser() user: AuthenticatedUser) {
    return this.access.currentAccess(user);
  }

  @Get()
  @ApiOperation({ summary: 'On-time delivery report (computed from DC data)' })
  report(
    @CurrentUser() user: AuthenticatedUser,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.otd.report(user, { from, to });
  }
}
