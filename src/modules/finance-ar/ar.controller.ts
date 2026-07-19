import { Body, Controller, Get, Param, Post, Query, Put } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import {
  AuthenticatedUser,
  CurrentUser,
} from '../../common/decorators/current-user.decorator';
import { PaginationQueryDto } from '../../common/dto/pagination.dto';
import { ArService } from './ar.service';
import {
  CompanySettingsDto,
  CreateCustomerReceiptDto,
  CreateMilestoneDto,
  CreateSalesInvoiceDto,
  GenerateEwayBillDto,
  RejectArDto,
} from './dto/ar.dto';

@ApiTags('finance-ar')
@ApiBearerAuth()
@Controller('finance/ar')
export class ArController {
  constructor(private readonly ar: ArService) {}
  @Get('settings') settings(@CurrentUser() u: AuthenticatedUser) {
    return this.ar.settings(u);
  }
  @Get('gst-readiness') gstReadiness(@CurrentUser() u: AuthenticatedUser) {
    return this.ar.gstReadiness(u);
  }
  @Get('reference/customers') customers(@CurrentUser() u: AuthenticatedUser) {
    return this.ar.customers(u);
  }
  @Get('reference/orders') orders(
    @Query('customerId') c: string | undefined,
    @CurrentUser() u: AuthenticatedUser,
  ) {
    return this.ar.orders(c, u);
  }
  @Put('settings') saveSettings(
    @Body() d: CompanySettingsDto,
    @CurrentUser() u: AuthenticatedUser,
  ) {
    return this.ar.saveSettings(d, u);
  }
  @Post('orders/:orderId/milestones') createMilestone(
    @Param('orderId') id: string,
    @Body() d: CreateMilestoneDto,
    @CurrentUser() u: AuthenticatedUser,
  ) {
    return this.ar.createMilestone(id, d, u);
  }
  @Get('orders/:orderId/milestones') milestones(
    @Param('orderId') id: string,
    @CurrentUser() u: AuthenticatedUser,
  ) {
    return this.ar.milestones(id, u);
  }
  @Post('invoices') createInvoice(
    @Body() d: CreateSalesInvoiceDto,
    @CurrentUser() u: AuthenticatedUser,
  ) {
    return this.ar.createInvoice(d, u);
  }
  @Get('invoices') invoices(
    @Query() q: PaginationQueryDto,
    @CurrentUser() u: AuthenticatedUser,
  ) {
    return this.ar.invoices(q, u);
  }
  @Get('invoices/:id') invoice(
    @Param('id') id: string,
    @CurrentUser() u: AuthenticatedUser,
  ) {
    return this.ar.invoice(id, u);
  }
  @Post('invoices/:id/submit') submitInvoice(
    @Param('id') id: string,
    @CurrentUser() u: AuthenticatedUser,
  ) {
    return this.ar.submitInvoice(id, u);
  }
  @Post('invoices/:id/approve') approveInvoice(
    @Param('id') id: string,
    @CurrentUser() u: AuthenticatedUser,
  ) {
    return this.ar.approveInvoice(id, u);
  }
  @Post('invoices/:id/reject') rejectInvoice(
    @Param('id') id: string,
    @Body() d: RejectArDto,
    @CurrentUser() u: AuthenticatedUser,
  ) {
    return this.ar.rejectInvoice(id, d.comment, u);
  }
  @Post('gst-submissions/:id/process') processGst(
    @Param('id') id: string,
    @CurrentUser() u: AuthenticatedUser,
  ) {
    return this.ar.processGst(id, u);
  }
  @Post('gst-submissions/:id/cancel') cancelGst(
    @Param('id') id: string,
    @Body('reason') reason: string,
    @CurrentUser() u: AuthenticatedUser,
  ) {
    return this.ar.cancelGst(id, reason, u);
  }
  @Post('invoices/:id/e-way-bill') queueEway(
    @Param('id') id: string,
    @Body() d: GenerateEwayBillDto,
    @CurrentUser() u: AuthenticatedUser,
  ) {
    return this.ar.queueEwayBill(id, d, u);
  }
  @Post('receipts') createReceipt(
    @Body() d: CreateCustomerReceiptDto,
    @CurrentUser() u: AuthenticatedUser,
  ) {
    return this.ar.createReceipt(d, u);
  }
  @Get('receipts') receipts(
    @Query() q: PaginationQueryDto,
    @CurrentUser() u: AuthenticatedUser,
  ) {
    return this.ar.receipts(q, u);
  }
  @Post('receipts/:id/submit') submitReceipt(
    @Param('id') id: string,
    @CurrentUser() u: AuthenticatedUser,
  ) {
    return this.ar.submitReceipt(id, u);
  }
  @Post('receipts/:id/approve') approveReceipt(
    @Param('id') id: string,
    @CurrentUser() u: AuthenticatedUser,
  ) {
    return this.ar.approveReceipt(id, u);
  }
  @Post('receipts/:id/reject') rejectReceipt(
    @Param('id') id: string,
    @Body() d: RejectArDto,
    @CurrentUser() u: AuthenticatedUser,
  ) {
    return this.ar.rejectReceipt(id, d.comment, u);
  }
  @Get('summary') summary(@CurrentUser() u: AuthenticatedUser) {
    return this.ar.arSummary(u);
  }
}
