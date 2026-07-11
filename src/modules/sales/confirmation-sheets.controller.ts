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
import { ConfirmationSheetsService } from './confirmation-sheets.service';
import {
  ConfirmSignedCopyDto,
  CreateConfirmationSheetDto,
  RejectConfirmationSheetDto,
  UpdateConfirmationSheetDto,
} from './dto/create-confirmation-sheet.dto';

/**
 * Order Confirmation Sheets. Order-scoped create/list live under
 * /orders/:orderId/confirmation-sheets; per-sheet operations under
 * /confirmation-sheets/:id. Service-layer access rules mirror the rest of
 * Sales (SALES-vertical/SUPER_ADMIN, owner/team write scope; Sales Head/
 * SUPER_ADMIN for sign/reject). All mutating routes are auto-audited.
 */
@ApiTags('order-confirmation-sheets')
@ApiBearerAuth()
@UseGuards(RolesGuard)
@Roles(Role.MANAGER, Role.EMPLOYEE, Role.SUPER_ADMIN)
@Controller()
export class ConfirmationSheetsController {
  constructor(private readonly service: ConfirmationSheetsService) {}

  @Post('orders/:orderId/confirmation-sheets')
  @ApiOperation({ summary: 'Create the first DRAFT confirmation sheet' })
  create(
    @Param('orderId') orderId: string,
    @Body() dto: CreateConfirmationSheetDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.create(orderId, dto, user);
  }

  @Get('orders/:orderId/confirmation-sheets')
  @ApiOperation({
    summary: 'List all confirmation sheets for an order (newest revision first)',
  })
  listForOrder(
    @Param('orderId') orderId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.listForOrder(orderId, user);
  }

  // Static route BEFORE :id so 'pending-approval' isn't captured as an :id.
  @Get('confirmation-sheets/pending-approval')
  @ApiOperation({
    summary:
      'Sheets awaiting internal countersignature across all orders (Sales Head / SUPER_ADMIN)',
  })
  findPendingApproval(@CurrentUser() user: AuthenticatedUser) {
    return this.service.findPendingApproval(user);
  }

  @Get('confirmation-sheets/:id')
  @ApiOperation({ summary: 'Get one confirmation sheet' })
  findOne(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.service.findOne(id, user);
  }

  @Patch('confirmation-sheets/:id')
  @ApiOperation({ summary: 'Edit a sheet (DRAFT only)' })
  update(
    @Param('id') id: string,
    @Body() dto: UpdateConfirmationSheetDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.update(id, dto, user);
  }

  @Post('confirmation-sheets/:id/generate-pdf')
  @ApiOperation({
    summary: 'Lock the sheet and move to AWAITING_CUSTOMER_SIGNATURE',
  })
  generatePdf(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.service.generatePdf(id, user);
  }

  @Post('confirmation-sheets/:id/signed-copy-upload-url')
  @ApiOperation({
    summary: 'Presign a PUT for the customer-signed copy (reuses R2 client)',
  })
  signedCopyUploadUrl(
    @Param('id') id: string,
    @Body() body: { contentType?: string },
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.createSignedCopyUploadUrl(
      id,
      body?.contentType ?? 'application/pdf',
      user,
    );
  }

  @Post('confirmation-sheets/:id/upload-signed-copy')
  @ApiOperation({
    summary: 'Confirm the signed copy landed → AWAITING_INTERNAL_SIGNATURE',
  })
  confirmSignedCopy(
    @Param('id') id: string,
    @Body() dto: ConfirmSignedCopyDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.confirmSignedCopy(id, dto, user);
  }

  @Get('confirmation-sheets/:id/signed-copy-download-url')
  @ApiOperation({ summary: 'Presigned GET for the uploaded signed copy' })
  signedCopyDownloadUrl(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.getSignedCopyDownloadUrl(id, user);
  }

  @Patch('confirmation-sheets/:id/sign')
  @ApiOperation({
    summary: 'Sales Head/SUPER_ADMIN countersigns → EXECUTED',
  })
  sign(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.service.sign(id, user);
  }

  @Patch('confirmation-sheets/:id/reject')
  @ApiOperation({
    summary: 'Sales Head/SUPER_ADMIN rejects (comments required) → REJECTED',
  })
  reject(
    @Param('id') id: string,
    @Body() dto: RejectConfirmationSheetDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.reject(id, dto, user);
  }

  @Post('confirmation-sheets/:id/request-revision')
  @ApiOperation({
    summary:
      'Create a new DRAFT revision pre-filled from this one (any pre-EXECUTED state)',
  })
  requestRevision(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.requestRevision(id, user);
  }
}
