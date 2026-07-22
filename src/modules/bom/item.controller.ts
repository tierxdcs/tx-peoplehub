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
import { ItemType, Role } from '@prisma/client';
import {
  AuthenticatedUser,
  CurrentUser,
} from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { RolesGuard } from '../../common/guards/roles.guard';
import { ItemService } from './item.service';
import { CreateItemDto, UpdateItemDto } from './dto/bom.dto';

/**
 * Item Master (§2). Read is broad (R&D + Store); create/update is R&D Head only
 * — enforced in the service. The coarse @Roles gate keeps the routes off
 * unauthenticated/foreign roles; the fine vertical/capability check is in the
 * access service.
 */
@ApiTags('items')
@ApiBearerAuth()
@UseGuards(RolesGuard)
@Roles(Role.MANAGER, Role.EMPLOYEE, Role.ADMIN, Role.SUPER_ADMIN)
@Controller('items')
export class ItemController {
  constructor(private readonly service: ItemService) {}

  @Get()
  @ApiOperation({ summary: 'List/search items (R&D or Store)' })
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Query('search') search?: string,
    @Query('activeOnly') activeOnly?: string,
  ) {
    return this.service.list(user, {
      search,
      activeOnly: activeOnly === 'true',
    });
  }

  @Post()
  @ApiOperation({ summary: 'Create an item (R&D Head/SA) — itemCode is server-generated from itemType' })
  create(@Body() dto: CreateItemDto, @CurrentUser() user: AuthenticatedUser) {
    return this.service.create(dto, user);
  }

  // Static route BEFORE @Get(':id') so 'next-code' isn't read as an id.
  @Get('next-code')
  @ApiOperation({
    summary: 'Preview the itemCode a create would currently receive for this type (does not consume a sequence value)',
  })
  previewNextCode(
    @Query('itemType') itemType: ItemType,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.previewNextItemCode(itemType, user);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get one item (R&D or Store)' })
  get(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.service.get(id, user);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update item technical data (R&D Head/SA)' })
  update(
    @Param('id') id: string,
    @Body() dto: UpdateItemDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.update(id, dto, user);
  }

  @Delete(':id')
  @ApiOperation({
    summary: 'Deactivate an item — no hard delete (R&D Head/SA)',
  })
  deactivate(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.service.deactivate(id, user);
  }
}
