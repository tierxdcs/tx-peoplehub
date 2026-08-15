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
import { Role } from '@prisma/client';
import {
  AuthenticatedUser,
  CurrentUser,
} from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { RolesGuard } from '../../common/guards/roles.guard';
import { PaginationQueryDto } from '../../common/dto/pagination.dto';
import { CreateBidDto } from './dto/create-bid.dto';
import { BidActionDto } from './dto/bid-action.dto';
import { BidStatusDto } from './dto/bid-status.dto';
import { PromoteInternalOrderDto } from './dto/promote-internal-order.dto';
import { ResolveBidLineItemDto } from './dto/resolve-bid-line-item.dto';
import { BidsService } from './bids.service';
import { OrdersService } from './orders.service';

@ApiTags('bids')
@ApiBearerAuth()
@UseGuards(RolesGuard)
@Roles(Role.MANAGER, Role.EMPLOYEE, Role.SUPER_ADMIN)
@Controller('bids')
export class BidsController {
  constructor(
    private readonly bidsService: BidsService,
    private readonly ordersService: OrdersService,
  ) {}

  @Post()
  @ApiOperation({ summary: 'Create a bid in DRAFT with line items' })
  create(@Body() dto: CreateBidDto, @CurrentUser() user: AuthenticatedUser) {
    return this.bidsService.create(dto, user);
  }

  @Get()
  @ApiOperation({ summary: 'List bids visible to the caller' })
  findAll(
    @Query() query: PaginationQueryDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.bidsService.findAll(query, user);
  }

  @Get('pending-approval')
  @ApiOperation({
    summary: 'Bids awaiting the caller’s approval decision (self-excluded)',
  })
  findPendingApproval(
    @Query() query: PaginationQueryDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.bidsService.findPendingApproval(query, user);
  }

  @Get('ad-hoc-count')
  @ApiOperation({
    summary:
      'Count of ad-hoc line items awaiting product setup across open bids',
  })
  countAdHoc(@CurrentUser() user: AuthenticatedUser) {
    return this.bidsService.countAdHocLineItems(user);
  }

  @Get(':id')
  @ApiOperation({ summary: 'View one bid (ownership-scoped)' })
  findOne(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.bidsService.findOne(id, user);
  }

  @Patch(':id/submit')
  @ApiOperation({
    summary: 'Submit a bid — routes for approval if discount > 10%, else SENT',
  })
  submit(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.bidsService.submit(id, user);
  }

  @Patch(':id/approve')
  @ApiOperation({ summary: 'Approve a PENDING_APPROVAL bid (manager/admin)' })
  approve(
    @Param('id') id: string,
    @Body() dto: BidActionDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.bidsService.approve(id, dto, user);
  }

  @Patch(':id/reject')
  @ApiOperation({ summary: 'Reject a PENDING_APPROVAL bid (manager/admin)' })
  reject(
    @Param('id') id: string,
    @Body() dto: BidActionDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.bidsService.reject(id, dto, user);
  }

  @Patch(':id/status')
  @ApiOperation({
    summary: 'Rep transition: APPROVED→SENT, SENT→ACCEPTED/EXPIRED',
  })
  markStatus(
    @Param('id') id: string,
    @Body() dto: BidStatusDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.bidsService.markStatus(id, dto.status, user);
  }

  @Patch(':id/line-items/:lineItemId/resolve')
  @ApiOperation({
    summary: 'Resolve an ad-hoc line item to a real Product before conversion',
  })
  resolveLineItem(
    @Param('id') id: string,
    @Param('lineItemId') lineItemId: string,
    @Body() dto: ResolveBidLineItemDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.bidsService.resolveLineItem(id, lineItemId, dto, user);
  }

  @Post(':id/convert-to-order')
  @ApiOperation({ summary: 'Convert an ACCEPTED bid into a CONFIRMED order' })
  convertToOrder(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.ordersService.convertFromBid(id, user);
  }

  @Post(':id/promote-internal-order')
  @ApiOperation({
    summary:
      'Promote an existing INTERNAL order to a CUSTOMER order for this ACCEPTED bid — preserves the internal order’s kickoff/PLM/Kanban history',
  })
  promoteInternalOrder(
    @Param('id') id: string,
    @Body() dto: PromoteInternalOrderDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.ordersService.promoteInternalOrder(id, dto, user);
  }
}
