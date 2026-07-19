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
import { GoodsReceiptNoteStatus, Role } from '@prisma/client';
import {
  AuthenticatedUser,
  CurrentUser,
} from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { RolesGuard } from '../../common/guards/roles.guard';
import { GoodsReceiptNoteService } from './goods-receipt-note.service';
import {
  CreateGoodsReceiptNoteDto,
  FinalizeQcDto,
  UpdateGoodsReceiptNoteDto,
} from './dto/goods-receipt-note.dto';

/**
 * Goods Receipt Notes + QC gate (Stores Phase 2). Company-wide read; the fine
 * gate (Production-vertical to receive, QC Inspector to inspect) lives in the
 * service. The coarse @Roles keeps the routes off unauthenticated/foreign roles.
 */
@ApiTags('goods-receipt-notes')
@ApiBearerAuth()
@UseGuards(RolesGuard)
@Roles(Role.MANAGER, Role.EMPLOYEE, Role.ADMIN, Role.SUPER_ADMIN)
@Controller('goods-receipt-notes')
export class GoodsReceiptNoteController {
  constructor(private readonly service: GoodsReceiptNoteService) {}

  @Get()
  @ApiOperation({ summary: 'List goods receipt notes (company-wide read)' })
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Query('status') status?: GoodsReceiptNoteStatus,
    @Query('purchaseOrderId') purchaseOrderId?: string,
  ) {
    return this.service.list(user, { status, purchaseOrderId });
  }

  @Post()
  @ApiOperation({
    summary:
      'Create a DRAFT goods receipt note (Production-vertical/SA). No stock movement.',
  })
  create(
    @Body() dto: CreateGoodsReceiptNoteDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.create(dto, user);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a goods receipt note (company-wide read)' })
  get(@Param('id') id: string) {
    return this.service.get(id);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Edit a DRAFT goods receipt note (Production-vertical/SA)' })
  update(
    @Param('id') id: string,
    @Body() dto: UpdateGoodsReceiptNoteDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.update(id, dto, user);
  }

  @Post(':id/submit')
  @ApiOperation({
    summary:
      'Submit a DRAFT GRN for QC (DRAFT → PENDING_QC). Still zero stock movement.',
  })
  submit(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.service.submit(id, user);
  }

  @Post(':id/cancel')
  @ApiOperation({ summary: 'Cancel a DRAFT or PENDING_QC goods receipt note' })
  cancel(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.service.cancel(id, user);
  }

  @Post(':id/finalize-qc')
  @ApiOperation({
    summary:
      'Finalize the QC gate (QC Inspector/SA). Accepted qty → STOCK_IN; rejected qty → NCR.',
  })
  finalizeQc(
    @Param('id') id: string,
    @Body() dto: FinalizeQcDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.finalizeQc(id, dto, user);
  }
}
