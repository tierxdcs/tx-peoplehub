import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
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
import { CreateVerticalDto } from './dto/create-vertical.dto';
import { UpdateVerticalOwnerDto } from './dto/update-vertical-owner.dto';
import { UpdateVerticalDto } from './dto/update-vertical.dto';
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

  @Patch(':id/owner')
  @Roles(Role.SUPER_ADMIN)
  @ApiOperation({ summary: 'Assign the employee responsible for a vertical' })
  updateOwner(@Param('id') id: string, @Body() dto: UpdateVerticalOwnerDto) {
    return this.verticalsService.updateOwner(id, dto);
  }

  @Patch(':id')
  @Roles(Role.SUPER_ADMIN)
  @ApiOperation({ summary: 'Edit a business vertical (CEO/SuperAdmin only)' })
  update(@Param('id') id: string, @Body() dto: UpdateVerticalDto) {
    return this.verticalsService.update(id, dto);
  }

  @Delete(':id')
  @Roles(Role.SUPER_ADMIN)
  @ApiOperation({ summary: 'Delete an unused vertical (CEO/SuperAdmin only)' })
  remove(@Param('id') id: string) {
    return this.verticalsService.remove(id);
  }

  @Get('me')
  @ApiOperation({
    summary: 'The caller’s own vertical (any authenticated user; null if none)',
  })
  findMine(@CurrentUser() user: AuthenticatedUser) {
    return this.verticalsService.findMine(user.verticalId);
  }

  @Get('options')
  @ApiOperation({
    summary:
      'Active verticals for a picker (any authenticated user) — e.g. tagging a Kanban card',
  })
  findOptions() {
    return this.verticalsService.findActiveOptions();
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
