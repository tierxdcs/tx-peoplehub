import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import {
  AuthenticatedUser,
  CurrentUser,
} from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { RolesGuard } from '../../common/guards/roles.guard';
import { HrManagerOrAdminGuard } from '../../common/guards/hr-manager-or-admin.guard';
import { CreateSalaryStructureDto } from './dto/create-salary-structure.dto';
import { SalaryStructuresService } from './salary-structures.service';

/**
 * Route order: /:employeeId/current and /:employeeId/history are
 * declared, but there's no bare :employeeId route to collide with — both
 * are always suffixed, same convention as payroll-runs.controller.ts.
 */
// ADMIN/SUPER_ADMIN or an HR-vertical MANAGER (payroll = salary/PII, so it's
// HR Managers, not all HR staff). RolesGuard admits MANAGER via @Roles; the
// HrManagerOrAdminGuard then rejects any MANAGER who isn't HR-vertical.
@ApiTags('salary-structures')
@ApiBearerAuth()
@UseGuards(RolesGuard, HrManagerOrAdminGuard)
@Roles(Role.ADMIN, Role.SUPER_ADMIN, Role.MANAGER)
@Controller('salary-structures')
export class SalaryStructuresController {
  constructor(
    private readonly salaryStructuresService: SalaryStructuresService,
  ) {}

  @Post()
  @ApiOperation({
    summary: "Set an employee's effective-dated salary structure",
  })
  create(
    @Body() dto: CreateSalaryStructureDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.salaryStructuresService.create(dto, user.id);
  }

  @Get(':employeeId/current')
  @ApiOperation({
    summary:
      "An employee's currently-effective salary structure (null if none set)",
  })
  getCurrent(@Param('employeeId') employeeId: string) {
    return this.salaryStructuresService.getCurrentEntity(employeeId);
  }

  @Get(':employeeId/history')
  @ApiOperation({
    summary: 'Full effective-dated history for one employee, most recent first',
  })
  getHistory(@Param('employeeId') employeeId: string) {
    return this.salaryStructuresService.getHistory(employeeId);
  }
}
