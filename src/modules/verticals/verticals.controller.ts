import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { Roles } from '../../common/decorators/roles.decorator';
import { RolesGuard } from '../../common/guards/roles.guard';
import { CreateVerticalDto } from './dto/create-vertical.dto';
import { VerticalsService } from './verticals.service';

@ApiTags('verticals')
@ApiBearerAuth()
@UseGuards(RolesGuard)
@Controller('verticals')
export class VerticalsController {
  constructor(private readonly verticalsService: VerticalsService) {}

  @Post()
  @Roles(Role.SUPER_ADMIN)
  @ApiOperation({ summary: 'Create a business vertical' })
  create(@Body() dto: CreateVerticalDto) {
    return this.verticalsService.create(dto);
  }

  @Get()
  @Roles(Role.ADMIN, Role.SUPER_ADMIN)
  @ApiOperation({ summary: 'List all verticals' })
  findAll() {
    return this.verticalsService.findAll();
  }
}
