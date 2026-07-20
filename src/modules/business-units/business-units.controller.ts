import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { Roles } from '../../common/decorators/roles.decorator';
import { RolesGuard } from '../../common/guards/roles.guard';
import { BusinessUnitsService } from './business-units.service';
import { CreateBusinessUnitDto } from './dto/create-business-unit.dto';
import { UpdateBusinessUnitDto } from './dto/update-business-unit.dto';

@ApiTags('business-units')
@ApiBearerAuth()
@UseGuards(RolesGuard)
@Controller('business-units')
export class BusinessUnitsController {
  constructor(private readonly service: BusinessUnitsService) {}

  @Post()
  @Roles(Role.SUPER_ADMIN)
  @ApiOperation({ summary: 'Create a business unit (SUPER_ADMIN only)' })
  create(@Body() dto: CreateBusinessUnitDto) {
    return this.service.create(dto);
  }

  @Get('options')
  @ApiOperation({
    summary:
      'Active business units for a picker (any authenticated user) — e.g. the product form dropdown',
  })
  findOptions() {
    return this.service.findActiveOptions();
  }

  @Get()
  @ApiOperation({
    summary: 'All business units incl. inactive (any authenticated user)',
  })
  findAll() {
    return this.service.findAll();
  }

  @Patch(':id')
  @Roles(Role.SUPER_ADMIN)
  @ApiOperation({
    summary: 'Edit / activate / deactivate a business unit (SUPER_ADMIN only)',
  })
  update(@Param('id') id: string, @Body() dto: UpdateBusinessUnitDto) {
    return this.service.update(id, dto);
  }
}
