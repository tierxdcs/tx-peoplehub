import {
  Body,
  Controller,
  Get,
  Param,
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
import { InventoryService } from './inventory.service';
import { StockAdjustmentDto } from './dto/bom.dto';

/**
 * Inventory MVP (§6). Read is R&D + Store; adjustments are Store-only — enforced
 * in the service.
 */
@ApiTags('inventory')
@ApiBearerAuth()
@UseGuards(RolesGuard)
@Roles(Role.MANAGER, Role.EMPLOYEE, Role.ADMIN, Role.SUPER_ADMIN)
@Controller('inventory')
export class InventoryController {
  constructor(private readonly service: InventoryService) {}

  @Get()
  @ApiOperation({ summary: 'List/search stock balances (R&D or Store)' })
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Query('search') search?: string,
    @Query('storeLocationId') storeLocationId?: string,
  ) {
    return this.service.listBalances(user, { search, storeLocationId });
  }

  @Get('stores')
  @ApiOperation({ summary: 'List store/warehouse locations' })
  stores(@CurrentUser() user: AuthenticatedUser) {
    return this.service.listStores(user);
  }

  @Post('adjustments')
  @ApiOperation({ summary: 'Apply a stock adjustment (Store/SA)' })
  adjust(@Body() dto: StockAdjustmentDto, @CurrentUser() user: AuthenticatedUser) {
    return this.service.adjust(dto, user);
  }

  @Get('items/:itemId')
  @ApiOperation({ summary: 'Stock balances (all locations) for one item' })
  itemBalances(
    @Param('itemId') itemId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.balancesForItem(itemId, user);
  }

  @Get('items/:itemId/adjustments')
  @ApiOperation({ summary: 'Stock adjustment history for one item' })
  itemAdjustments(
    @Param('itemId') itemId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.adjustmentHistory(itemId, user);
  }
}
