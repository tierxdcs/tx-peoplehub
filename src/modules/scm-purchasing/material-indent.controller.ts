import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { MaterialIndentStatus, Role } from '@prisma/client';
import {
  AuthenticatedUser,
  CurrentUser,
} from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { RolesGuard } from '../../common/guards/roles.guard';
import { MaterialService } from './material.service';
import { CreateMaterialIndentDto } from './dto/material-indent.dto';

/**
 * Material Indents (Stores Phase 3). Company-wide read; creation is gated in
 * the service to Production-vertical/SA (Stores). Status is always derived from
 * issue history.
 */
@ApiTags('material-indents')
@ApiBearerAuth()
@UseGuards(RolesGuard)
@Roles(Role.MANAGER, Role.EMPLOYEE, Role.ADMIN, Role.SUPER_ADMIN)
@Controller('material-indents')
export class MaterialIndentController {
  constructor(private readonly service: MaterialService) {}

  @Get()
  @ApiOperation({ summary: 'List material indents (company-wide read)' })
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Query('status') status?: MaterialIndentStatus,
    @Query('projectKickoffId') projectKickoffId?: string,
  ) {
    return this.service.listIndents(user, { status, projectKickoffId });
  }

  @Post()
  @ApiOperation({ summary: 'Raise a material indent (Production-vertical/SA)' })
  create(
    @Body() dto: CreateMaterialIndentDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.createIndent(dto, user);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a material indent with issue history (company-wide read)' })
  get(@Param('id') id: string) {
    return this.service.getIndent(id);
  }

  @Post(':id/cancel')
  @ApiOperation({ summary: 'Cancel an indent with no issued material (Production-vertical/SA)' })
  cancel(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.service.cancelIndent(id, user);
  }
}
