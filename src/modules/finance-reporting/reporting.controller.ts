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
import { CashFlowCategory } from '@prisma/client';
import {
  AuthenticatedUser,
  CurrentUser,
} from '../../common/decorators/current-user.decorator';
import {
  AuditorGrantDto,
  CreatePackDto,
  CreateRolloverDto,
  ReportingRangeDto,
} from './dto/reporting.dto';
import { ReportingService } from './reporting.service';
@ApiTags('finance-reporting')
@ApiBearerAuth()
@Controller('finance/reporting')
export class ReportingController {
  constructor(private readonly s: ReportingService) {}
  @Get('dashboard') dashboard(
    @Query() q: ReportingRangeDto,
    @CurrentUser() u: AuthenticatedUser,
  ) {
    return this.s.dashboard(q, u);
  }
  @Get('cash-flow') cash(
    @Query() q: ReportingRangeDto,
    @CurrentUser() u: AuthenticatedUser,
  ) {
    return this.s.cashFlow(q, u);
  }
  @Get('balance-sheet') bs(
    @Query('asOf') d: string,
    @CurrentUser() u: AuthenticatedUser,
  ) {
    return this.s.balanceSheetReport(d, u);
  }
  @Patch('accounts/:id/cash-flow/:category') map(
    @Param('id') id: string,
    @Param('category') c: CashFlowCategory,
    @CurrentUser() u: AuthenticatedUser,
  ) {
    return this.s.setCashFlowCategory(id, c, u);
  }
  @Get('packs') packs(@CurrentUser() u: AuthenticatedUser) {
    return this.s.packs(u);
  }
  @Post('packs') pack(
    @Body() d: CreatePackDto,
    @CurrentUser() u: AuthenticatedUser,
  ) {
    return this.s.createPack(d, u);
  }
  @Post('packs/:id/submit') submitPack(
    @Param('id') id: string,
    @CurrentUser() u: AuthenticatedUser,
  ) {
    return this.s.submitPack(id, u);
  }
  @Post('packs/:id/approve') approvePack(
    @Param('id') id: string,
    @CurrentUser() u: AuthenticatedUser,
  ) {
    return this.s.approvePack(id, u);
  }
  @Post('packs/:id/publish') publish(
    @Param('id') id: string,
    @CurrentUser() u: AuthenticatedUser,
  ) {
    return this.s.publishPack(id, u);
  }
  @Post('auditors') auditor(
    @Body() d: AuditorGrantDto,
    @CurrentUser() u: AuthenticatedUser,
  ) {
    return this.s.grantAuditor(d, u);
  }
  @Get('auditors') auditors(@CurrentUser() u: AuthenticatedUser) {
    return this.s.auditors(u);
  }
  @Post('auditors/:employeeId/revoke') revoke(
    @Param('employeeId') id: string,
    @CurrentUser() u: AuthenticatedUser,
  ) {
    return this.s.revokeAuditor(id, u);
  }
  @Get('rollovers') rollovers(@CurrentUser() u: AuthenticatedUser) {
    return this.s.rollovers(u);
  }
  @Post('rollovers') rollover(
    @Body() d: CreateRolloverDto,
    @CurrentUser() u: AuthenticatedUser,
  ) {
    return this.s.createRollover(d, u);
  }
  @Post('rollovers/:id/submit') submitRoll(
    @Param('id') id: string,
    @CurrentUser() u: AuthenticatedUser,
  ) {
    return this.s.submitRollover(id, u);
  }
  @Post('rollovers/:id/approve') approveRoll(
    @Param('id') id: string,
    @CurrentUser() u: AuthenticatedUser,
  ) {
    return this.s.approveRollover(id, u);
  }
}
