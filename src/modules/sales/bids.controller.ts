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

  @Post(':id/convert-to-order')
  @ApiOperation({ summary: 'Convert an ACCEPTED bid into a CONFIRMED order' })
  convertToOrder(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.ordersService.convertFromBid(id, user);
  }
}
