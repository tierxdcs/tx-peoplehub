import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  AuthenticatedUser,
  CurrentUser,
} from '../../common/decorators/current-user.decorator';
import { ExpenseClaimsService } from './expense-claims.service';
import { ExpenseCategoriesService } from './expense-categories.service';
import {
  AddExpenseClaimLineDto,
  ConfirmReceiptDto,
  CreateExpenseClaimDto,
  CreateReceiptUploadUrlDto,
  RejectExpenseClaimDto,
  UpdateExpenseClaimDto,
} from './dto/expense-claims.dto';

/**
 * Employee expense claims. Every authenticated employee may raise and submit a
 * claim for themselves — there is no vertical/role gate on those routes.
 * Approve/reject/pay and the review queue are gated inside the service to the
 * Accounts Head or SUPER_ADMIN, so authorization lives with the business rule
 * (self-approval override included), not on the route decorator.
 */
@ApiTags('expense-claims')
@ApiBearerAuth()
@Controller('expense-claims')
export class ExpenseClaimsController {
  constructor(
    private readonly claims: ExpenseClaimsService,
    private readonly categories: ExpenseCategoriesService,
  ) {}

  // Active categories for the claim-line picker (any employee).
  @Get('categories')
  @ApiOperation({ summary: 'List active expense categories (for line picker)' })
  listCategories() {
    return this.categories.listActive();
  }

  // ── Receipts (two-step upload) ─────────────────────────────────────────────

  @Post('receipts/upload-url')
  @ApiOperation({ summary: 'Mint a presigned PUT URL for a receipt file' })
  createReceiptUploadUrl(
    @Body() dto: CreateReceiptUploadUrlDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.claims.createReceiptUploadUrl(dto, user);
  }

  @Post('receipts/:id/confirm')
  @ApiOperation({ summary: 'Confirm a receipt uploaded (head-check → ACTIVE)' })
  confirmReceipt(
    @Param('id') id: string,
    @Body() _dto: ConfirmReceiptDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.claims.confirmReceipt(id, user);
  }

  @Get('receipts/:id/download-url')
  @ApiOperation({ summary: 'Short-lived presigned download URL for a receipt' })
  receiptDownloadUrl(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.claims.receiptDownloadUrl(id, user);
  }

  // ── Claims ──────────────────────────────────────────────────────────────────

  @Get('mine')
  @ApiOperation({ summary: 'My expense claims' })
  listMine(@CurrentUser() user: AuthenticatedUser) {
    return this.claims.listMine(user);
  }

  @Get('review')
  @ApiOperation({ summary: 'Approver queue (Accounts Head / Super Admin)' })
  listForReview(@CurrentUser() user: AuthenticatedUser) {
    return this.claims.listForReview(user);
  }

  @Post()
  @ApiOperation({ summary: 'Create a draft expense claim' })
  create(
    @Body() dto: CreateExpenseClaimDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.claims.createClaim(dto, user);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get an expense claim' })
  get(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.claims.getClaim(id, user);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Edit a draft claim (title)' })
  update(
    @Param('id') id: string,
    @Body() dto: UpdateExpenseClaimDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.claims.updateClaim(id, dto, user);
  }

  @Post(':id/lines')
  @ApiOperation({ summary: 'Add a line (receipt mandatory) to a draft claim' })
  addLine(
    @Param('id') id: string,
    @Body() dto: AddExpenseClaimLineDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.claims.addLine(id, dto, user);
  }

  @Delete(':id/lines/:lineId')
  @ApiOperation({ summary: 'Remove a line from a draft claim' })
  removeLine(
    @Param('id') id: string,
    @Param('lineId') lineId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.claims.removeLine(id, lineId, user);
  }

  // ── Lifecycle ─────────────────────────────────────────────────────────────

  @Post(':id/submit')
  @ApiOperation({ summary: 'Submit a draft claim for approval' })
  submit(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.claims.submit(id, user);
  }

  @Post(':id/approve')
  @ApiOperation({ summary: 'Approve a claim — posts the GL journal' })
  approve(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.claims.approve(id, user);
  }

  @Post(':id/reject')
  @ApiOperation({ summary: 'Reject a claim (comment required)' })
  reject(
    @Param('id') id: string,
    @Body() dto: RejectExpenseClaimDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.claims.reject(id, dto, user);
  }

  @Post(':id/pay')
  @ApiOperation({ summary: 'Mark an approved claim paid — posts payout journal' })
  markPaid(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.claims.markPaid(id, user);
  }
}
