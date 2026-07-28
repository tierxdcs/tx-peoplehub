import {
  Body,
  Controller,
  Delete,
  Get,
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
import { Public } from '../../common/decorators/public.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { RolesGuard } from '../../common/guards/roles.guard';
import {
  CreateCustomerProgressLinkDto,
  CustomerDeliverySignoffDto,
  ResolveCustomerProgressDto,
} from './dto/customer-order-progress.dto';
import { CustomerOrderProgressService } from './customer-order-progress.service';

@ApiTags('customer-order-progress')
@ApiBearerAuth()
@UseGuards(RolesGuard)
@Roles(Role.MANAGER, Role.EMPLOYEE, Role.SUPER_ADMIN)
@Controller()
export class CustomerOrderProgressController {
  constructor(private readonly service: CustomerOrderProgressService) {}

  @Post('orders/:orderId/customer-progress-links')
  @ApiOperation({ summary: 'Create a revocable customer order-progress link' })
  create(
    @Param('orderId') orderId: string,
    @Body() dto: CreateCustomerProgressLinkDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.createLink(orderId, dto.password, user);
  }

  @Get('orders/:orderId/customer-progress-links')
  list(
    @Param('orderId') orderId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.listLinks(orderId, user);
  }

  @Delete('orders/:orderId/customer-progress-links/:linkId')
  revoke(
    @Param('orderId') orderId: string,
    @Param('linkId') linkId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.revokeLink(orderId, linkId, user);
  }

  @Public()
  @Post('public/order-progress/:token/resolve')
  resolve(
    @Param('token') token: string,
    @Body() dto: ResolveCustomerProgressDto,
  ) {
    return this.service.resolvePublic(token, dto.password);
  }

  @Public()
  @Post('public/order-progress/:token/signoff')
  signoff(
    @Param('token') token: string,
    @Body() dto: CustomerDeliverySignoffDto,
  ) {
    return this.service.submitSignoff(token, dto);
  }
}
