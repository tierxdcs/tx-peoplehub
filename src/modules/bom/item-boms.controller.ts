import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
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
import { BomService } from './bom.service';
import { LinkSupplierDto } from './dto/bom.dto';

/**
 * Item-scoped BOM listing + Item↔Supplier links.
 * - GET  /items/:itemId/boms                 — revisions of an item's BOM (R&D)
 * - GET  /items/:itemId/suppliers            — qualified/unqualified supplier links
 * - POST /items/:itemId/suppliers            — link a supplier (R&D Head)
 * - DELETE /items/:itemId/suppliers/:linkId  — unlink (R&D Head)
 */
@ApiTags('items')
@ApiBearerAuth()
@UseGuards(RolesGuard)
@Roles(Role.MANAGER, Role.EMPLOYEE, Role.ADMIN, Role.SUPER_ADMIN)
@Controller('items/:itemId')
export class ItemBomsController {
  constructor(private readonly service: BomService) {}

  @Get('boms')
  @ApiOperation({ summary: 'All BOM revisions for an item, newest first (R&D)' })
  listBoms(@Param('itemId') itemId: string, @CurrentUser() user: AuthenticatedUser) {
    return this.service.listForItem(itemId, user);
  }

  @Get('suppliers')
  @ApiOperation({ summary: 'Supplier links for an item (R&D or Store)' })
  listSuppliers(@Param('itemId') itemId: string, @CurrentUser() user: AuthenticatedUser) {
    return this.service.listItemSuppliers(itemId, user);
  }

  @Post('suppliers')
  @ApiOperation({ summary: 'Link a qualified supplier to an item (R&D Head/SA)' })
  linkSupplier(
    @Param('itemId') itemId: string,
    @Body() dto: LinkSupplierDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.linkSupplier(itemId, dto, user);
  }

  @Delete('suppliers/:linkId')
  @HttpCode(204)
  @ApiOperation({ summary: 'Unlink a supplier from an item (R&D Head/SA)' })
  async unlinkSupplier(
    @Param('itemId') itemId: string,
    @Param('linkId') linkId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    await this.service.unlinkSupplier(itemId, linkId, user);
  }
}
