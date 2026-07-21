import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { Roles } from '../../common/decorators/roles.decorator';
import { RolesGuard } from '../../common/guards/roles.guard';
import { HrManagerOrAdminGuard } from '../../common/guards/hr-manager-or-admin.guard';
import { CreateStatutoryConfigDto } from './dto/create-statutory-config.dto';
import { StatutoryConfigService } from './statutory-config.service';

/**
 * Deliberately not seeded — this table starts empty and must stay empty
 * until a CA/payroll-compliance specialist has verified real rates. See
 * StatutoryConfig's schema doc comment and PayrollRunsService.processRun().
 *
 * Access: ADMIN/SUPER_ADMIN or an HR-vertical MANAGER (see salary-structures).
 */
@ApiTags('statutory-config')
@ApiBearerAuth()
@UseGuards(RolesGuard, HrManagerOrAdminGuard)
@Controller('statutory-config')
export class StatutoryConfigController {
  constructor(
    private readonly statutoryConfigService: StatutoryConfigService,
  ) {}

  @Post()
  @Roles(Role.ADMIN, Role.SUPER_ADMIN, Role.MANAGER)
  @ApiOperation({ summary: 'Add a statutory rate/threshold config version' })
  create(@Body() dto: CreateStatutoryConfigDto) {
    return this.statutoryConfigService.create(dto);
  }

  @Get()
  @Roles(Role.ADMIN, Role.SUPER_ADMIN, Role.MANAGER)
  @ApiOperation({ summary: 'List all statutory config versions' })
  findAll() {
    return this.statutoryConfigService.findAll();
  }
}
