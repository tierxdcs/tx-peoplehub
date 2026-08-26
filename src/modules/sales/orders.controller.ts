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
import { Role } from '@prisma/client';
import {
  AuthenticatedUser,
  CurrentUser,
} from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { RolesGuard } from '../../common/guards/roles.guard';
import { CreateInternalOrderDto } from './dto/create-internal-order.dto';
import { ListOrdersQueryDto } from './dto/list-orders-query.dto';
import { UpdateLineCustomerFacingDto } from './dto/customer-facing-line.dto';
import { UpdateOrderStatusDto } from './dto/update-order-status.dto';
import { ResolveBidLineItemDto } from './dto/resolve-bid-line-item.dto';
import { UpdateOrderLineItemDto } from './dto/update-order-line-item.dto';
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

  @Patch(':id/line-items/:lineItemId/customer-facing')
  @ApiOperation({
    summary:
      'Set/clear the customer-facing display name/description for one line (display-only; never touches the Product record)',
  })
  updateLineCustomerFacing(
    @Param('id') id: string,
    @Param('lineItemId') lineItemId: string,
    @Body() dto: UpdateLineCustomerFacingDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.ordersService.updateLineCustomerFacing(
      id,
      lineItemId,
      dto,
      user,
    );
  }

  @Patch(':id/line-items/:lineItemId')
  @ApiOperation({
    summary:
      "Correct one line's quantity and/or unit price (the received PO didn't match the quotation). CONFIRMED orders only; re-derives the order total.",
  })
  updateLineItem(
    @Param('id') id: string,
    @Param('lineItemId') lineItemId: string,
    @Body() dto: UpdateOrderLineItemDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.ordersService.updateLineItem(id, lineItemId, dto, user);
  }

  @Delete(':id/line-items/:lineItemId')
  @ApiOperation({
    summary:
      "Remove one line the customer's PO didn't cover. CONFIRMED orders only; refused when the line has PLM, QC or dispatch history, or is the last line.",
  })
  deleteLineItem(
    @Param('id') id: string,
    @Param('lineItemId') lineItemId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.ordersService.deleteLineItem(id, lineItemId, user);
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
