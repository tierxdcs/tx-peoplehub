import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { PurchaseOrderStatus, Role } from '@prisma/client';
import {
  AuthenticatedUser,
  CurrentUser,
} from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { RolesGuard } from '../../common/guards/roles.guard';
import { PurchaseOrderService } from './purchase-order.service';
import { PurchaseOrderEmailService } from './purchase-order-email.service';
import {
  CreatePurchaseOrderDto,
  EmailPurchaseOrderDto,
  RejectAdHocPurchaseOrderDto,
  UpdatePurchaseOrderDto,
} from './dto/purchase-order.dto';

/**
 * Purchase Orders (Stores Phase 1). Company-wide read; SCM-vertical Manager+ /
 * SUPER_ADMIN manage — the fine gate lives in the service. The coarse @Roles
 * keeps the routes off unauthenticated/foreign roles.
 */
@ApiTags('purchase-orders')
@ApiBearerAuth()
@UseGuards(RolesGuard)
@Roles(Role.MANAGER, Role.EMPLOYEE, Role.ADMIN, Role.SUPER_ADMIN)
@Controller('purchase-orders')
export class PurchaseOrderController {
  constructor(
    private readonly service: PurchaseOrderService,
    private readonly poEmail: PurchaseOrderEmailService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'List purchase orders (company-wide read)' })
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Query('status') status?: PurchaseOrderStatus,
  ) {
    return this.service.list(user, { status });
  }

  @Post()
  @ApiOperation({
    summary:
      'Create a purchase order (SCM Manager+/SA). Returns a qualification warning if the partner is unqualified — does not block.',
  })
  create(
    @Body() dto: CreatePurchaseOrderDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.create(dto, user);
  }

  @Get(':id')
  @ApiOperation({
    summary: 'Get a purchase order with lines (company-wide read)',
  })
  get(@Param('id') id: string) {
    return this.service.get(id);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Edit a DRAFT purchase order (SCM Manager+/SA)' })
  update(
    @Param('id') id: string,
    @Body() dto: UpdatePurchaseOrderDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.update(id, dto, user);
  }

  @Post(':id/issue')
  @ApiOperation({ summary: 'Issue a fully APPROVED purchase order' })
  issue(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.service.issue(id, user);
  }

  @Post(':id/submit-for-approval')
  @ApiOperation({
    summary: 'Submit a DRAFT PO into its value-based approval ladder',
  })
  submitForApproval(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.submitForApproval(id, user);
  }

  @Post(':id/approve')
  @ApiOperation({ summary: 'Approve the current CSCO, COO, or CEO step' })
  approve(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.service.approve(id, user);
  }

  @Post(':id/reject')
  @ApiOperation({ summary: 'Reject the current PO approval step' })
  reject(
    @Param('id') id: string,
    @Body() dto: RejectAdHocPurchaseOrderDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.rejectApproval(id, dto, user);
  }

  @Post(':id/email')
  @ApiOperation({
    summary:
      'Email an issued purchase order to the supplier/vendor, with the order PDF attached (SCM Manager+/SA)',
  })
  email(
    @Param('id') id: string,
    @Body() dto: EmailPurchaseOrderDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.poEmail.emailToParty(id, dto, user);
  }

  @Post(':id/approve-ad-hoc')
  @Roles(Role.SUPER_ADMIN)
  @ApiOperation({ summary: 'CEO approval for an ad-hoc purchase order' })
  approveAdHoc(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.approveAdHoc(id, user);
  }

  @Post(':id/reject-ad-hoc')
  @Roles(Role.SUPER_ADMIN)
  @ApiOperation({ summary: 'CEO rejection for an ad-hoc purchase order' })
  rejectAdHoc(
    @Param('id') id: string,
    @Body() dto: RejectAdHocPurchaseOrderDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.rejectAdHoc(id, dto, user);
  }

  @Post(':id/cancel')
  @ApiOperation({
    summary: 'Cancel a DRAFT or ISSUED purchase order (SCM Manager+/SA)',
  })
  cancel(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.service.cancel(id, user);
  }

  @Delete(':id')
  @ApiOperation({
    summary:
      'Delete a PO except ISSUED/FULLY_RECEIVED (SCM vertical or SUPER_ADMIN/CEO)',
  })
  remove(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.service.remove(id, user);
  }
}
