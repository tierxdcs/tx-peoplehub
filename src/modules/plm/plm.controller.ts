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
import {
  AssignPlmOwnerDto,
  CreatePlmVendorInviteDto,
  LinkPlmProductionBoardDto,
  PlmPhotoUploadUrlDto,
  PlmProductionUpdateDto,
  PlmTransitionDto,
  RejectPlmDesignReviewDto,
} from './dto/plm.dto';
import { PlmService } from './plm.service';
import { PlmVendorUpdateService } from './plm-vendor-update.service';

@ApiTags('plm')
@ApiBearerAuth()
@UseGuards(RolesGuard)
@Roles(Role.EMPLOYEE, Role.MANAGER, Role.ADMIN, Role.SUPER_ADMIN)
@Controller('plm')
export class PlmController {
  constructor(
    private readonly service: PlmService,
    private readonly vendorUpdates: PlmVendorUpdateService,
  ) {}

  @Get('dashboard')
  @ApiOperation({ summary: 'Active PLM work visible to the current user' })
  dashboard(@CurrentUser() user: AuthenticatedUser) {
    return this.service.dashboardForUser(user);
  }

  @Get('orders/:orderId')
  @ApiOperation({ summary: 'Order-level rollup of all line-item PLM trackers' })
  listForOrder(
    @Param('orderId') orderId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.listForOrder(orderId, user);
  }

  @Get('trackers/:id')
  get(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.get(id, user);
  }

  @Post('trackers/:id/confirm-stage')
  confirmStage(
    @Param('id') id: string,
    @Body() dto: PlmTransitionDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.confirmStage(id, dto, user);
  }

  @Post('trackers/:id/design-review/submit')
  submitDesignReview(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.submitDesignReview(id, user);
  }

  @Post('trackers/:id/design-review/approve')
  approveDesignReview(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.approveDesignReview(id, user);
  }

  @Post('trackers/:id/design-review/reject')
  rejectDesignReview(
    @Param('id') id: string,
    @Body() dto: RejectPlmDesignReviewDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.rejectDesignReview(id, dto, user);
  }

  @Patch('trackers/:id/production-board')
  linkProductionBoard(
    @Param('id') id: string,
    @Body() dto: LinkPlmProductionBoardDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.linkProductionBoard(id, dto, user);
  }

  @Patch('trackers/:id/owner')
  assignOwner(
    @Param('id') id: string,
    @Body() dto: AssignPlmOwnerDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.assignOwner(id, dto, user);
  }

  @Post('trackers/:id/vendor-invites')
  createVendorInvite(
    @Param('id') id: string,
    @Body() dto: CreatePlmVendorInviteDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.vendorUpdates.createInvite(id, dto, user);
  }

  @Get('trackers/:id/vendor-invites')
  listVendorInvites(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.vendorUpdates.listInvites(id, user);
  }

  @Get('update-photos/:id/download-url')
  photoDownloadUrl(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.vendorUpdates.photoDownloadUrl(id, user);
  }

  @Post('vendor-invites/:id/revoke')
  revokeVendorInvite(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.vendorUpdates.revokeInvite(id, user);
  }

  @Post('trackers/:id/auditor-photo-upload-url')
  auditorPhotoUploadUrl(
    @Param('id') id: string,
    @Body() dto: PlmPhotoUploadUrlDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.vendorUpdates.internalPhotoUploadUrl(id, dto, user);
  }

  @Post('trackers/:id/auditor-update')
  auditorUpdate(
    @Param('id') id: string,
    @Body() dto: PlmProductionUpdateDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.vendorUpdates.submitInternal(id, dto, user);
  }
}
