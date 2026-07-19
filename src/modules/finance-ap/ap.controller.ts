import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import {
  AuthenticatedUser,
  CurrentUser,
} from '../../common/decorators/current-user.decorator';
import { PaginationQueryDto } from '../../common/dto/pagination.dto';
import { ApService } from './ap.service';
import {
  ApApprovalDto,
  CreateApInvoiceDto,
  CreateApPaymentDto,
  ExecutePaymentDto,
  RejectApDto,
} from './dto/ap.dto';

@ApiTags('finance-ap')
@ApiBearerAuth()
@Controller('finance/ap')
export class ApController {
  constructor(private readonly ap: ApService) {}

  @Get('reference/partners')
  partners(@CurrentUser() user: AuthenticatedUser) {
    return this.ap.partners(user);
  }

  @Get('reference/purchase-orders')
  purchaseOrders(@CurrentUser() user: AuthenticatedUser) {
    return this.ap.purchaseOrders(user);
  }

  @Post('invoices')
  createInvoice(
    @Body() dto: CreateApInvoiceDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.ap.createInvoice(dto, user);
  }

  @Get('invoices')
  invoices(
    @Query() query: PaginationQueryDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.ap.invoices(query, user);
  }

  @Get('invoices/:id')
  invoice(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.ap.getInvoice(id, user);
  }

  @Post('invoices/:id/submit')
  submitInvoice(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.ap.submitInvoice(id, user);
  }

  @Post('invoices/:id/approve')
  approveInvoice(
    @Param('id') id: string,
    @Body() dto: ApApprovalDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.ap.approveInvoice(id, dto, user);
  }

  @Post('invoices/:id/reject')
  rejectInvoice(
    @Param('id') id: string,
    @Body() dto: RejectApDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.ap.rejectInvoice(id, dto.comment, user);
  }

  @Post('payments')
  createPayment(
    @Body() dto: CreateApPaymentDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.ap.createPayment(dto, user);
  }

  @Get('payments')
  payments(
    @Query() query: PaginationQueryDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.ap.payments(query, user);
  }

  @Post('payments/:id/submit')
  submitPayment(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.ap.submitPayment(id, user);
  }

  @Post('payments/:id/approve')
  approvePayment(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.ap.approvePayment(id, user);
  }

  @Post('payments/:id/reject')
  rejectPayment(
    @Param('id') id: string,
    @Body() dto: RejectApDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.ap.rejectPayment(id, dto.comment, user);
  }

  @Post('payments/:id/execute')
  executePayment(
    @Param('id') id: string,
    @Body() dto: ExecutePaymentDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.ap.executePayment(id, dto, user);
  }

  @Get('summary')
  summary(@CurrentUser() user: AuthenticatedUser) {
    return this.ap.summary(user);
  }

  @Get('po-commitments')
  poCommitments(@CurrentUser() user: AuthenticatedUser) {
    return this.ap.poCommitments(user);
  }

  @Get('payment-calendar')
  calendar(
    @Query('from') from: string,
    @Query('to') to: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.ap.calendar(from, to, user);
  }
}
