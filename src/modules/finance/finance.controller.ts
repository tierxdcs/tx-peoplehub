import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser, AuthenticatedUser } from '../../common/decorators/current-user.decorator';
import { PaginationQueryDto } from '../../common/dto/pagination.dto';
import {
  CreateAccountDto,
  CreateCostCenterDto,
  CreateExchangeRateDto,
  CreateFiscalYearDto,
  CreateJournalDto,
  DaybookQueryDto,
  RejectFinanceDto,
  ReportQueryDto,
  UpdateAccountDto,
  UpdatePeriodStatusDto,
} from './dto/finance.dto';
import { FinanceService } from './finance.service';

@ApiTags('finance')
@ApiBearerAuth()
@Controller('finance')
export class FinanceController {
  constructor(private readonly finance: FinanceService) {}

  @Get('access') getAccess(@CurrentUser() user: AuthenticatedUser) { return this.finance.getAccess(user); }

  @Post('fiscal-years') createFiscalYear(@Body() dto: CreateFiscalYearDto, @CurrentUser() user: AuthenticatedUser) { return this.finance.createFiscalYear(dto, user); }
  @Get('fiscal-years') fiscalYears(@CurrentUser() user: AuthenticatedUser) { return this.finance.fiscalYears(user); }
  @Patch('periods/:id/status') setPeriodStatus(@Param('id') id: string, @Body() dto: UpdatePeriodStatusDto, @CurrentUser() user: AuthenticatedUser) { return this.finance.setPeriodStatus(id, dto.status, user); }

  @Post('accounts') createAccount(@Body() dto: CreateAccountDto, @CurrentUser() user: AuthenticatedUser) { return this.finance.createAccount(dto, user); }
  @Get('accounts') accounts(@CurrentUser() user: AuthenticatedUser) { return this.finance.accounts(user); }
  @Patch('accounts/:id') updateAccount(@Param('id') id: string, @Body() dto: UpdateAccountDto, @CurrentUser() user: AuthenticatedUser) { return this.finance.updateAccount(id, dto, user); }

  @Post('cost-centers') createCostCenter(@Body() dto: CreateCostCenterDto, @CurrentUser() user: AuthenticatedUser) { return this.finance.createCostCenter(dto, user); }
  @Get('cost-centers') costCenters(@CurrentUser() user: AuthenticatedUser) { return this.finance.costCenters(user); }

  @Get('currencies') currencies(@CurrentUser() user: AuthenticatedUser) { return this.finance.currencies(user); }
  @Post('exchange-rates') createExchangeRate(@Body() dto: CreateExchangeRateDto, @CurrentUser() user: AuthenticatedUser) { return this.finance.createExchangeRate(dto, user); }
  @Get('exchange-rates') exchangeRates(@CurrentUser() user: AuthenticatedUser) { return this.finance.exchangeRates(user); }

  @Post('journals') @ApiOperation({ summary: 'Create a balanced draft manual journal' })
  createJournal(@Body() dto: CreateJournalDto, @CurrentUser() user: AuthenticatedUser) { return this.finance.createJournal(dto, user); }
  @Get('journals') journals(@Query() query: PaginationQueryDto, @CurrentUser() user: AuthenticatedUser) { return this.finance.journals(query, user); }
  @Get('journals/pending-approval') pending(@Query() query: PaginationQueryDto, @CurrentUser() user: AuthenticatedUser) { return this.finance.journals(query, user, true); }
  @Get('journals/:id') journal(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) { return this.finance.journal(id, user); }
  @Patch('journals/:id') updateJournal(@Param('id') id: string, @Body() dto: CreateJournalDto, @CurrentUser() user: AuthenticatedUser) { return this.finance.updateJournal(id, dto, user); }
  @Post('journals/:id/submit') submit(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) { return this.finance.submitJournal(id, user); }
  @Post('journals/:id/approve') approve(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) { return this.finance.approveJournal(id, user); }
  @Post('journals/:id/reject') reject(@Param('id') id: string, @Body() dto: RejectFinanceDto, @CurrentUser() user: AuthenticatedUser) { return this.finance.rejectJournal(id, dto.comment, user); }
  @Post('journals/:id/reverse') reverse(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) { return this.finance.reverseJournal(id, user); }

  @Get('daybook') @ApiOperation({ summary: 'Chronological Day Book across all voucher types (read-only)' })
  daybook(@Query() query: DaybookQueryDto, @CurrentUser() user: AuthenticatedUser) { return this.finance.daybook(query, user); }

  @Get('reports/trial-balance') trialBalance(@Query() query: ReportQueryDto, @CurrentUser() user: AuthenticatedUser) { return this.finance.trialBalance(query, user); }
  @Get('reports/general-ledger') generalLedger(@Query() query: ReportQueryDto, @CurrentUser() user: AuthenticatedUser) { return this.finance.generalLedger(query, user); }
  @Get('reports/profit-and-loss') profitAndLoss(@Query() query: ReportQueryDto, @CurrentUser() user: AuthenticatedUser) { return this.finance.profitAndLoss(query, user); }
}
