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
import {
  AuthenticatedUser,
  CurrentUser,
} from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { RolesGuard } from '../../common/guards/roles.guard';
import { ScmResourcePlanService } from './scm-resource-plan.service';
import { UpdateResourcePlanLineDto } from './dto/scm-resource-plan.dto';

/**
 * SCM Resource Planning Sheet. Coarse role gate here (any assigned role reaches
 * the handler); the fine-grained three-tier gate — view = SCM/CEO/Finance,
 * generate = SCM Manager+/SA, edit = SCM staff/SA — is enforced in the service
 * via ScmResourcePlanAccessService.
 */
@ApiTags('scm-resource-plans')
@ApiBearerAuth()
@UseGuards(RolesGuard)
@Roles(Role.MANAGER, Role.EMPLOYEE, Role.ADMIN, Role.SUPER_ADMIN)
@Controller('scm/resource-plans')
export class ScmResourcePlanController {
  constructor(private readonly service: ScmResourcePlanService) {}

  @Get('projects')
  @ApiOperation({
    summary:
      'List every completed project with its plan status + variance (§3)',
  })
  listProjects(@CurrentUser() user: AuthenticatedUser) {
    return this.service.listEligibleProjects(user);
  }

  @Get('summary')
  @ApiOperation({ summary: 'Cross-project variance summary — every plan (§5)' })
  summary(@CurrentUser() user: AuthenticatedUser) {
    return this.service.crossProjectSummary(user);
  }

  @Get('projects/:kickoffId')
  @ApiOperation({ summary: 'Get a project’s resource plan (null if none)' })
  read(
    @Param('kickoffId') kickoffId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.read(kickoffId, user);
  }

  @Post('projects/:kickoffId/generate')
  @ApiOperation({
    summary:
      'Generate/regenerate the plan (preserves entered negotiated prices) — SCM Manager+/SA (§2)',
  })
  generate(
    @Param('kickoffId') kickoffId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.generate(kickoffId, user);
  }

  @Patch('lines/:lineId')
  @ApiOperation({
    summary: 'Edit a line’s negotiated price / notes — any SCM staff/SA (§4)',
  })
  updateLine(
    @Param('lineId') lineId: string,
    @Body() dto: UpdateResourcePlanLineDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.updateLine(lineId, dto, user);
  }
}
