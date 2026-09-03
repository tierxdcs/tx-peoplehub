import {
  Body,
  Controller,
  Get,
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
import { HrManagerOrAdminGuard } from '../../common/guards/hr-manager-or-admin.guard';
import { CreatePayrollRunDto } from './dto/create-payroll-run.dto';
import { PayrollRunsService } from './payroll-runs.service';

// ADMIN/SUPER_ADMIN or an HR-vertical MANAGER (see salary-structures for the
// two-guard rationale).
@ApiTags('payroll-runs')
@ApiBearerAuth()
@UseGuards(RolesGuard, HrManagerOrAdminGuard)
@Roles(Role.ADMIN, Role.SUPER_ADMIN, Role.MANAGER)
@Controller('payroll-runs')
export class PayrollRunsController {
  constructor(private readonly payrollRunsService: PayrollRunsService) {}

  @Post()
  @ApiOperation({ summary: 'Initiate a payroll run for a month (DRAFT)' })
  create(
    @Body() dto: CreatePayrollRunDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.payrollRunsService.create(dto, user.id);
  }

  @Get()
  @ApiOperation({ summary: 'List all payroll runs, most recent first' })
  findAll() {
    return this.payrollRunsService.findAll();
  }

  @Get(':id')
  @ApiOperation({ summary: 'View a payroll run status/summary' })
  findOne(@Param('id') id: string) {
    return this.payrollRunsService.findOne(id);
  }

  @Get(':id/payslips')
  @ApiOperation({ summary: 'List every payslip generated for one run' })
  findPayslips(@Param('id') id: string) {
    return this.payrollRunsService.findPayslips(id);
  }

  @Post(':id/process')
  @ApiOperation({
    summary:
      'Run computation for all active employees and generate payslips (DRAFT -> COMPLETED)',
  })
  process(@Param('id') id: string) {
    return this.payrollRunsService.processRun(id);
  }

  @Post(':id/submit')
  @ApiOperation({
    summary: 'Submit a COMPLETED payroll run to Accounts for approval',
  })
  submit(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.payrollRunsService.submit(id, user);
  }

  @Patch(':id/lock')
  @ApiOperation({
    summary: 'Legacy endpoint; direct locking is disabled—submit to Accounts',
  })
  lock(@Param('id') id: string) {
    return this.payrollRunsService.lock(id);
  }
}
