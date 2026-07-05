import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { Roles } from '../../common/decorators/roles.decorator';
import { RolesGuard } from '../../common/guards/roles.guard';
import { CreateStatutoryConfigDto } from './dto/create-statutory-config.dto';
import { StatutoryConfigService } from './statutory-config.service';

/**
 * Deliberately not seeded — this table starts empty and must stay empty
 * until a CA/payroll-compliance specialist has verified real rates. See
 * StatutoryConfig's schema doc comment and PayrollRunsService.processRun().
 */
@ApiTags('statutory-config')
@ApiBearerAuth()
@UseGuards(RolesGuard)
@Controller('statutory-config')
export class StatutoryConfigController {
  constructor(
    private readonly statutoryConfigService: StatutoryConfigService,
  ) {}

  @Post()
  @Roles(Role.ADMIN, Role.SUPER_ADMIN)
  @ApiOperation({ summary: 'Add a statutory rate/threshold config version' })
  create(@Body() dto: CreateStatutoryConfigDto) {
    return this.statutoryConfigService.create(dto);
  }

  @Get()
  @Roles(Role.ADMIN, Role.SUPER_ADMIN)
  @ApiOperation({ summary: 'List all statutory config versions' })
  findAll() {
    return this.statutoryConfigService.findAll();
  }
}
