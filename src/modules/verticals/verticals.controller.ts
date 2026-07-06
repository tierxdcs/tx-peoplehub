import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import {
  AuthenticatedUser,
  CurrentUser,
} from '../../common/decorators/current-user.decorator';
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

  @Get('me')
  @ApiOperation({
    summary: 'The caller’s own vertical (any authenticated user; null if none)',
  })
  findMine(@CurrentUser() user: AuthenticatedUser) {
    return this.verticalsService.findMine(user.verticalId);
  }

  @Get()
  @ApiOperation({
    summary: 'List all verticals (Admin/SuperAdmin or HR-vertical staff)',
  })
  async findAll(@CurrentUser() user: AuthenticatedUser) {
    await this.verticalsService.assertCanListAll(user);
    return this.verticalsService.findAll();
  }
}
