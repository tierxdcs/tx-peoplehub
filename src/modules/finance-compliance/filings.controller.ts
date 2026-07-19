import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { GstReturnType, TdsReturnQuarter } from '@prisma/client';
import { AuthenticatedUser, CurrentUser } from '../../common/decorators/current-user.decorator';
import { AllocateChallanDto, CreateTdsChallanDto, DueDateDto, EvidenceUploadDto, FilingEvidenceDto, ImportGstr2bDto, SetInvoiceTdsDto, TaxPartyProfileDto, TdsPrepareDto } from './dto/filings.dto';
import { FilingsService } from './filings.service';

@ApiTags('finance-filings')
@ApiBearerAuth()
@Controller('finance/filings')
export class FilingsController {
  constructor(private readonly filings: FilingsService) {}

  @Get('dashboard') dashboard(@Query('taxPeriod') p: string | undefined, @CurrentUser() u: AuthenticatedUser) { return this.filings.dashboard(p, u); }
  @Post('tax-profiles') taxProfile(@Body() d: TaxPartyProfileDto, @CurrentUser() u: AuthenticatedUser) { return this.filings.saveTaxProfile(d, u); }
  @Patch('ap-invoices/:id/tds') invoiceTds(@Param('id') id: string, @Body() d: SetInvoiceTdsDto, @CurrentUser() u: AuthenticatedUser) { return this.filings.setInvoiceTds(id, d, u); }
  @Post('tds-challans') challan(@Body() d: CreateTdsChallanDto, @CurrentUser() u: AuthenticatedUser) { return this.filings.createChallan(d, u); }
  @Post('tds-challans/:id/allocate') allocate(@Param('id') id: string, @Body() d: AllocateChallanDto, @CurrentUser() u: AuthenticatedUser) { return this.filings.allocateChallan(id, d, u); }
  @Post('due-dates') dueDate(@Body() d: DueDateDto, @CurrentUser() u: AuthenticatedUser) { return this.filings.saveDueDate(d, u); }
  @Post('due-dates/:id/complete') completeDue(@Param('id') id: string, @Body('reference') ref: string, @CurrentUser() u: AuthenticatedUser) { return this.filings.completeDueDate(id, ref, u); }
  @Post('evidence/upload-url') evidenceUpload(@Body() d: EvidenceUploadDto, @CurrentUser() u: AuthenticatedUser) { return this.filings.evidenceUpload(d, u); }
  @Post('evidence/:id/confirm') evidenceConfirm(@Param('id') id: string, @CurrentUser() u: AuthenticatedUser) { return this.filings.confirmEvidence(id, u); }
  @Get('evidence/:id/download') evidenceDownload(@Param('id') id: string, @CurrentUser() u: AuthenticatedUser) { return this.filings.downloadEvidence(id, u); }
  @Post('gst/:type/:taxPeriod/prepare') prepareGst(@Param('type') t: GstReturnType, @Param('taxPeriod') p: string, @CurrentUser() u: AuthenticatedUser) { return this.filings.prepareGst(t, p, u); }
  @Post('gst/:id/submit') submitGst(@Param('id') id: string, @CurrentUser() u: AuthenticatedUser) { return this.filings.submitGst(id, u); }
  @Post('gst/:id/approve') approveGst(@Param('id') id: string, @CurrentUser() u: AuthenticatedUser) { return this.filings.approveGst(id, u); }
  @Post('gst/:id/file-evidence') fileGst(@Param('id') id: string, @Body() d: FilingEvidenceDto, @CurrentUser() u: AuthenticatedUser) { return this.filings.fileGst(id, d, u); }
  @Post('gstr2b/import') import2b(@Body() d: ImportGstr2bDto, @CurrentUser() u: AuthenticatedUser) { return this.filings.importGstr2b(d, u); }
  @Post('gstr2b/:taxPeriod/reconcile') reconcile2b(@Param('taxPeriod') p: string, @CurrentUser() u: AuthenticatedUser) { return this.filings.reconcileGstr2b(p, u); }
  @Post('tds/:financialYear/:quarter/prepare') prepareTds(@Param('financialYear') fy: string, @Param('quarter') q: TdsReturnQuarter, @Body() d: TdsPrepareDto, @CurrentUser() u: AuthenticatedUser) { return this.filings.prepareTds(fy, q, d, u); }
  @Post('tds/:id/submit') submitTds(@Param('id') id: string, @CurrentUser() u: AuthenticatedUser) { return this.filings.submitTds(id, u); }
  @Post('tds/:id/approve') approveTds(@Param('id') id: string, @CurrentUser() u: AuthenticatedUser) { return this.filings.approveTds(id, u); }
  @Post('tds/:id/file-evidence') fileTds(@Param('id') id: string, @Body() d: FilingEvidenceDto, @CurrentUser() u: AuthenticatedUser) { return this.filings.fileTds(id, d, u); }
}
