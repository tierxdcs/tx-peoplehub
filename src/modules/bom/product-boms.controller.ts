import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import {
  AuthenticatedUser,
  CurrentUser,
} from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { RolesGuard } from '../../common/guards/roles.guard';
import { BomService } from './bom.service';

/** Product-scoped BOM listing: GET /products/:productId/boms (§10). */
@ApiTags('boms')
@ApiBearerAuth()
@UseGuards(RolesGuard)
@Roles(Role.MANAGER, Role.EMPLOYEE, Role.ADMIN, Role.SUPER_ADMIN)
@Controller('products/:productId/boms')
export class ProductBomsController {
  constructor(private readonly service: BomService) {}

  @Get()
  @ApiOperation({ summary: 'All BOM revisions for a product, newest first' })
  list(
    @Param('productId') productId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.listForProduct(productId, user);
  }
}
