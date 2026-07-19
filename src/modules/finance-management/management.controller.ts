import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import {
  AuthenticatedUser,
  CurrentUser,
} from '../../common/decorators/current-user.decorator';
import {
  CreateBudgetDto,
  CreateFixedAssetDto,
  CreateScheduleDto,
  ManagementRangeDto,
  RejectManagementDto,
  RunAsOfDto,
} from './dto/management.dto';
import { ManagementService } from './management.service';
@ApiTags('finance-management')
@ApiBearerAuth()
@Controller('finance/management')
export class ManagementController {
  constructor(private readonly management: ManagementService) {}
  @Get('budgets') budgets(@CurrentUser() u: AuthenticatedUser) {
    return this.management.budgets(u);
  }
  @Post('budgets') createBudget(
    @Body() d: CreateBudgetDto,
    @CurrentUser() u: AuthenticatedUser,
  ) {
    return this.management.createBudget(d, u);
  }
  @Post('budgets/:id/submit') submitBudget(
    @Param('id') id: string,
    @CurrentUser() u: AuthenticatedUser,
  ) {
    return this.management.submitBudget(id, u);
  }
  @Post('budgets/:id/approve') approveBudget(
    @Param('id') id: string,
    @CurrentUser() u: AuthenticatedUser,
  ) {
    return this.management.approveBudget(id, u);
  }
  @Post('budgets/:id/reject') rejectBudget(
    @Param('id') id: string,
    @Body() d: RejectManagementDto,
    @CurrentUser() u: AuthenticatedUser,
  ) {
    return this.management.rejectBudget(id, d.comment, u);
  }
  @Get('budgets/:id/variance') variance(
    @Param('id') id: string,
    @CurrentUser() u: AuthenticatedUser,
  ) {
    return this.management.budgetVsActual(id, u);
  }
  @Get('assets') assets(@CurrentUser() u: AuthenticatedUser) {
    return this.management.assets(u);
  }
  @Post('assets') createAsset(
    @Body() d: CreateFixedAssetDto,
    @CurrentUser() u: AuthenticatedUser,
  ) {
    return this.management.createAsset(d, u);
  }
  @Post('assets/:id/submit') submitAsset(
    @Param('id') id: string,
    @CurrentUser() u: AuthenticatedUser,
  ) {
    return this.management.submitAsset(id, u);
  }
  @Post('assets/:id/approve') approveAsset(
    @Param('id') id: string,
    @CurrentUser() u: AuthenticatedUser,
  ) {
    return this.management.approveAsset(id, u);
  }
  @Post('assets/:id/reject') rejectAsset(
    @Param('id') id: string,
    @Body() d: RejectManagementDto,
    @CurrentUser() u: AuthenticatedUser,
  ) {
    return this.management.rejectAsset(id, d.comment, u);
  }
  @Post('assets/run-depreciation') depreciate(
    @Body() d: RunAsOfDto,
    @CurrentUser() u: AuthenticatedUser,
  ) {
    return this.management.runDepreciation(d.asOf, u);
  }
  @Get('schedules') schedules(@CurrentUser() u: AuthenticatedUser) {
    return this.management.schedules(u);
  }
  @Post('schedules') createSchedule(
    @Body() d: CreateScheduleDto,
    @CurrentUser() u: AuthenticatedUser,
  ) {
    return this.management.createSchedule(d, u);
  }
  @Post('schedules/:id/submit') submitSchedule(
    @Param('id') id: string,
    @CurrentUser() u: AuthenticatedUser,
  ) {
    return this.management.submitSchedule(id, u);
  }
  @Post('schedules/:id/approve') approveSchedule(
    @Param('id') id: string,
    @CurrentUser() u: AuthenticatedUser,
  ) {
    return this.management.approveSchedule(id, u);
  }
  @Post('schedules/:id/reject') rejectSchedule(
    @Param('id') id: string,
    @Body() d: RejectManagementDto,
    @CurrentUser() u: AuthenticatedUser,
  ) {
    return this.management.rejectSchedule(id, d.comment, u);
  }
  @Post('schedules/run-due') runSchedules(
    @Body() d: RunAsOfDto,
    @CurrentUser() u: AuthenticatedUser,
  ) {
    return this.management.runSchedules(d.asOf, u);
  }
  @Get('reports/inventory-valuation') inventory(
    @Query('asOf') asOf: string,
    @CurrentUser() u: AuthenticatedUser,
  ) {
    return this.management.inventoryValuation(asOf, u);
  }
  @Get('reports/project-profitability') profitability(
    @Query() q: ManagementRangeDto,
    @CurrentUser() u: AuthenticatedUser,
  ) {
    return this.management.projectProfitability(q, u);
  }
}
