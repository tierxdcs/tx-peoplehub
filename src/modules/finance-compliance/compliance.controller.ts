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
import {
  AuthenticatedUser,
  CurrentUser,
} from '../../common/decorators/current-user.decorator';
import { PaginationQueryDto } from '../../common/dto/pagination.dto';
import { ComplianceService } from './compliance.service';
import {
  CreateAdjustmentNoteDto,
  CreateTdsSectionDto,
  PreparePeriodCloseDto,
  RejectComplianceDto,
  ReportRangeDto,
  SetItcStatusDto,
  SetPaymentHoldDto,
  SetTdsSectionActiveDto,
} from './dto/compliance.dto';

@ApiTags('finance-compliance')
@ApiBearerAuth()
@Controller('finance/compliance')
export class ComplianceController {
  constructor(private readonly compliance: ComplianceService) {}

  @Get('tds-sections') tds(@CurrentUser() u: AuthenticatedUser) {
    return this.compliance.tdsSections(u);
  }
  @Post('tds-sections') createTds(
    @Body() d: CreateTdsSectionDto,
    @CurrentUser() u: AuthenticatedUser,
  ) {
    return this.compliance.createTdsSection(d, u);
  }
  @Patch('tds-sections/:id/active') setTdsActive(
    @Param('id') id: string,
    @Body() d: SetTdsSectionActiveDto,
    @CurrentUser() u: AuthenticatedUser,
  ) {
    return this.compliance.setTdsActive(id, d.isActive, u);
  }

  @Get('notes') notes(
    @Query() q: PaginationQueryDto,
    @CurrentUser() u: AuthenticatedUser,
  ) {
    return this.compliance.notes(q, u);
  }
  @Post('notes') createNote(
    @Body() d: CreateAdjustmentNoteDto,
    @CurrentUser() u: AuthenticatedUser,
  ) {
    return this.compliance.createNote(d, u);
  }
  @Post('notes/:id/submit') submitNote(
    @Param('id') id: string,
    @CurrentUser() u: AuthenticatedUser,
  ) {
    return this.compliance.submitNote(id, u);
  }
  @Post('notes/:id/approve') approveNote(
    @Param('id') id: string,
    @CurrentUser() u: AuthenticatedUser,
  ) {
    return this.compliance.approveNote(id, u);
  }
  @Post('notes/:id/reject') rejectNote(
    @Param('id') id: string,
    @Body() d: RejectComplianceDto,
    @CurrentUser() u: AuthenticatedUser,
  ) {
    return this.compliance.rejectNote(id, d.comment, u);
  }

  @Patch('ap-invoices/:id/itc') setItc(
    @Param('id') id: string,
    @Body() d: SetItcStatusDto,
    @CurrentUser() u: AuthenticatedUser,
  ) {
    return this.compliance.setItcStatus(id, d, u);
  }
  @Patch('ap-invoices/:id/payment-hold') setHold(
    @Param('id') id: string,
    @Body() d: SetPaymentHoldDto,
    @CurrentUser() u: AuthenticatedUser,
  ) {
    return this.compliance.setPaymentHold(id, d, u);
  }
  @Get('gst-purchase-register') gstRegister(
    @Query() q: ReportRangeDto,
    @CurrentUser() u: AuthenticatedUser,
  ) {
    return this.compliance.gstPurchaseRegister(q, u);
  }
  @Get('ap-aging') aging(
    @Query('asOf') asOf: string,
    @CurrentUser() u: AuthenticatedUser,
  ) {
    return this.compliance.apAging(asOf, u);
  }
  @Get('cash-forecast') forecast(
    @Query() q: ReportRangeDto,
    @CurrentUser() u: AuthenticatedUser,
  ) {
    return this.compliance.cashForecast(q, u);
  }

  @Get('period-close/:periodId') closeStatus(
    @Param('periodId') id: string,
    @CurrentUser() u: AuthenticatedUser,
  ) {
    return this.compliance.closeStatus(id, u);
  }
  @Post('period-close/:periodId/prepare') prepareClose(
    @Param('periodId') id: string,
    @Body() d: PreparePeriodCloseDto,
    @CurrentUser() u: AuthenticatedUser,
  ) {
    return this.compliance.prepareClose(id, d, u);
  }
  @Post('period-close/:periodId/submit') submitClose(
    @Param('periodId') id: string,
    @CurrentUser() u: AuthenticatedUser,
  ) {
    return this.compliance.submitClose(id, u);
  }
  @Post('period-close/:periodId/approve') approveClose(
    @Param('periodId') id: string,
    @CurrentUser() u: AuthenticatedUser,
  ) {
    return this.compliance.approveClose(id, u);
  }
  @Post('period-close/:periodId/reject') rejectClose(
    @Param('periodId') id: string,
    @Body() d: RejectComplianceDto,
    @CurrentUser() u: AuthenticatedUser,
  ) {
    return this.compliance.rejectClose(id, d.comment, u);
  }
}
