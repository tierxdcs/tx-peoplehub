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
import {
  CreateMilestoneTemplateDto,
  UpdateMilestoneTemplateDto,
} from './dto/milestone-template.dto';
import { MilestoneTemplateService } from './milestone-template.service';

/**
 * Milestone-template administration. Managed by Admin + CEO (SUPER_ADMIN) — a
 * settings surface, deliberately looser than provisioning-item-type management
 * (CEO-only), since these are operational config, not an approval-routing
 * control. The kickoff-facing "which templates apply to this kickoff" query
 * lives on the ProjectKickoff controller, not here.
 */
@ApiTags('milestone-templates')
@ApiBearerAuth()
@UseGuards(RolesGuard)
@Roles(Role.ADMIN, Role.SUPER_ADMIN)
@Controller('milestone-templates')
export class MilestoneTemplateController {
  constructor(private readonly service: MilestoneTemplateService) {}

  @Get()
  @ApiOperation({ summary: 'List all milestone templates (Admin/CEO)' })
  list() {
    return this.service.list();
  }

  @Post()
  @ApiOperation({ summary: 'Create a milestone template (Admin/CEO)' })
  create(@Body() dto: CreateMilestoneTemplateDto) {
    return this.service.create(dto);
  }

  @Patch(':id')
  @ApiOperation({
    summary: 'Edit / reorder / deactivate a milestone template (Admin/CEO)',
  })
  update(@Param('id') id: string, @Body() dto: UpdateMilestoneTemplateDto) {
    return this.service.update(id, dto);
  }
}
