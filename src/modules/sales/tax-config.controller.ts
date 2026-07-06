import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { Roles } from '../../common/decorators/roles.decorator';
import { RolesGuard } from '../../common/guards/roles.guard';
import { CreateTaxConfigDto } from './dto/create-tax-config.dto';
import { TaxConfigService } from './tax-config.service';

/**
 * GST rate configuration. Restricted to Sales MANAGER and SUPER_ADMIN —
 * rate setup is a management action, and every rate carries a sourceNote.
 */
@ApiTags('tax-config')
@ApiBearerAuth()
@UseGuards(RolesGuard)
@Roles(Role.MANAGER, Role.SUPER_ADMIN)
@Controller('tax-config')
export class TaxConfigController {
  constructor(private readonly taxConfigService: TaxConfigService) {}

  @Post()
  @ApiOperation({ summary: 'Add a versioned GST rate' })
  create(@Body() dto: CreateTaxConfigDto) {
    return this.taxConfigService.create(dto);
  }

  @Get()
  @ApiOperation({ summary: 'List all GST rate versions' })
  findAll() {
    return this.taxConfigService.findAll();
  }
}
