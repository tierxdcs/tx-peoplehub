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
import { CreateInternalOrderDto } from './dto/create-internal-order.dto';
import { ListOrdersQueryDto } from './dto/list-orders-query.dto';
import { UpdateOrderStatusDto } from './dto/update-order-status.dto';
import { ResolveBidLineItemDto } from './dto/resolve-bid-line-item.dto';
import { OrdersService } from './orders.service';

/**
 * A CUSTOMER order is created only by converting an accepted bid
 * (POST /bids/:id/convert-to-order). This controller additionally exposes
 * direct creation of INTERNAL orders (samples / speculative builds with no
 * bid), plus read + status-progression.
 */
@ApiTags('orders')
@ApiBearerAuth()
@UseGuards(RolesGuard)
@Roles(Role.MANAGER, Role.EMPLOYEE, Role.SUPER_ADMIN)
@Controller('orders')
export class OrdersController {
  constructor(private readonly ordersService: OrdersService) {}

  @Post()
  @ApiOperation({
    summary:
      'Create an INTERNAL order (no bid/OCS/customer commitment). Sales, R&D, or Project Manager staff only.',
  })
  createInternal(
    @Body() dto: CreateInternalOrderDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.ordersService.createInternal(dto, user);
  }

  @Get()
  @ApiOperation({ summary: 'List orders visible to the caller' })
  findAll(
    @Query() query: ListOrdersQueryDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.ordersService.findAll(query, user);
  }

  @Get(':id')
  @ApiOperation({ summary: 'View one order (ownership-scoped)' })
  findOne(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.ordersService.findOne(id, user);
  }

  @Patch(':id/status')
  @ApiOperation({
    summary:
      'Advance order status (CONFIRMED→IN_PRODUCTION→…→DELIVERED, or CANCELLED)',
  })
  updateStatus(
    @Param('id') id: string,
    @Body() dto: UpdateOrderStatusDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.ordersService.updateStatus(id, dto.status, user);
  }

  @Patch(':id/line-items/:lineItemId/resolve')
  @ApiOperation({
    summary: 'Resolve an internal order ad-hoc line to an active Product',
  })
  resolveLineItem(
    @Param('id') id: string,
    @Param('lineItemId') lineItemId: string,
    @Body() dto: ResolveBidLineItemDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.ordersService.resolveLineItem(id, lineItemId, dto, user);
  }
}
