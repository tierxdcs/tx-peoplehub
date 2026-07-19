import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { DeliveryChallanStatus, Role } from '@prisma/client';
import {
  AuthenticatedUser,
  CurrentUser,
} from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { RolesGuard } from '../../common/guards/roles.guard';
import { DeliveryChallanService } from './delivery-challan.service';
import {
  ConfirmPodDto,
  CreateDeliveryChallanDto,
  EwayBillDto,
  UpdateDcStatusDto,
  UpdateDeliveryChallanDto,
} from './dto/delivery-challan.dto';

/**
 * Logistics & Dispatch. Company-wide read; the create/dispatch/POD gate lives in
 * the service (Production-vertical/SA), and final-QC clear is gated to QC
 * inspectors. Note: there is deliberately NO endpoint that creates a sales
 * invoice — dispatch seeds a DRAFT invoice via a module-to-module call, not an
 * HTTP route a logistics user can reach.
 */
@ApiTags('logistics-dispatch')
@ApiBearerAuth()
@UseGuards(RolesGuard)
@Roles(Role.MANAGER, Role.EMPLOYEE, Role.ADMIN, Role.SUPER_ADMIN)
@Controller('logistics/delivery-challans')
export class DeliveryChallanController {
  constructor(private readonly service: DeliveryChallanService) {}

  @Get()
  @ApiOperation({ summary: 'List delivery challans (company-wide read)' })
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Query('status') status?: DeliveryChallanStatus,
    @Query('orderId') orderId?: string,
  ) {
    return this.service.list(user, { status, orderId });
  }

  @Post()
  @ApiOperation({ summary: 'Create a DRAFT delivery challan (Production-vertical/SA)' })
  create(
    @Body() dto: CreateDeliveryChallanDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.create(dto, user);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a delivery challan (company-wide read)' })
  get(@Param('id') id: string) {
    return this.service.get(id);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Edit a DRAFT delivery challan (Production-vertical/SA)' })
  update(
    @Param('id') id: string,
    @Body() dto: UpdateDeliveryChallanDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.update(id, dto, user);
  }

  @Post(':id/dispatch')
  @ApiOperation({
    summary:
      'Dispatch (DRAFT → DISPATCHED): generates STOCK_OUT + seeds a DRAFT invoice. QC-gated.',
  })
  dispatch(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.service.dispatch(id, user);
  }

  @Post(':id/cancel')
  @ApiOperation({ summary: 'Cancel a DRAFT delivery challan (Production-vertical/SA)' })
  cancel(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.service.cancel(id, user);
  }

  @Post(':id/e-way-bill')
  @ApiOperation({ summary: 'Record e-way bill details (manual entry after GST portal)' })
  ewayBill(
    @Param('id') id: string,
    @Body() dto: EwayBillDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.setEwayBill(id, dto, user);
  }

  @Patch(':id/status')
  @ApiOperation({ summary: 'Progress status (IN_TRANSIT / DELIVERED)' })
  updateStatus(
    @Param('id') id: string,
    @Body() dto: UpdateDcStatusDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.updateStatus(id, dto.status, user);
  }

  @Post(':id/pod/upload-url')
  @ApiOperation({ summary: 'Mint a presigned PUT URL for the POD document (R2)' })
  podUploadUrl(
    @Param('id') id: string,
    @Body() body: { fileName: string; contentType: string },
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.createPodUploadUrl(id, body.fileName, body.contentType, user);
  }

  @Post(':id/pod')
  @ApiOperation({ summary: 'Confirm POD upload + record receiver/date (→ DELIVERED)' })
  confirmPod(
    @Param('id') id: string,
    @Body() body: ConfirmPodDto & { storageKey: string },
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.confirmPod(id, body, body.storageKey, user);
  }

  @Get(':id/pod/download-url')
  @ApiOperation({ summary: 'Presigned GET URL for the POD document (company-wide read)' })
  podDownloadUrl(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.service.podDownloadUrl(id, user);
  }

  @Post('orders/:orderId/clear-final-qc')
  @ApiOperation({
    summary: 'Clear outbound final QC for an order (QC Inspector/SA) — dispatch precondition',
  })
  clearFinalQc(
    @Param('orderId') orderId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.clearFinalQc(orderId, user);
  }
}
