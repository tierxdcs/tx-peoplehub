import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import {
  AuthenticatedUser,
  CurrentUser,
} from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { RolesGuard } from '../../common/guards/roles.guard';
import { CustomerBomIntakeService } from './customer-bom-intake.service';
import {
  CreateCustomerBomIntakeDto,
  CustomerBomMatchDto,
  CustomerBomUploadUrlDto,
} from './dto/customer-bom-intake.dto';

@ApiTags('customer-bom-intake')
@ApiBearerAuth()
@UseGuards(RolesGuard)
@Roles(Role.MANAGER, Role.EMPLOYEE, Role.SUPER_ADMIN)
@Controller('opportunities/:opportunityId/customer-bom-intakes')
export class CustomerBomIntakeController {
  constructor(private readonly service: CustomerBomIntakeService) {}

  @Get()
  list(
    @Param('opportunityId') opportunityId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.list(opportunityId, user);
  }

  @Post('matches')
  @ApiOperation({
    summary: 'Fuzzy Item Master candidates; excludes all cost fields',
  })
  matches(
    @Body() dto: CustomerBomMatchDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.matches(dto.description, user);
  }

  @Post('upload-url')
  uploadUrl(
    @Body() dto: CustomerBomUploadUrlDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.uploadUrl(dto, user);
  }

  @Post()
  create(
    @Param('opportunityId') opportunityId: string,
    @Body() dto: CreateCustomerBomIntakeDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.create(opportunityId, dto, user);
  }
}
