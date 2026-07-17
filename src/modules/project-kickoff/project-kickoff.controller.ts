import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
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
import { ProjectKickoffService } from './project-kickoff.service';
import {
  CreateActionItemDto,
  CreateAttendeeDto,
  CreateKickoffDto,
  CreateMilestoneDto,
  CreateRiskDto,
  UpdateActionItemDto,
  UpdateDeliveryItemDto,
  UpdateKickoffDto,
  UpdateMilestoneDto,
  UpdateRiskDto,
} from './dto/project-kickoff.dto';

/**
 * Project Kickoff API. The class-level RolesGuard keeps plain ADMIN out (they
 * see no operational data); the real gating — PM-to-create, membership-to-view
 * — lives in ProjectKickoffAccessService, since RolesGuard can't express
 * "creator or internal attendee of THIS kickoff".
 */
@ApiTags('project-kickoff')
@ApiBearerAuth()
@UseGuards(RolesGuard)
@Roles(Role.MANAGER, Role.EMPLOYEE, Role.ADMIN, Role.SUPER_ADMIN)
@Controller('project-kickoffs')
export class ProjectKickoffController {
  constructor(private readonly service: ProjectKickoffService) {}

  // ── Kickoff ────────────────────────────────────────────────────────
  @Post()
  @ApiOperation({ summary: 'Create a kickoff (Project Manager / SUPER_ADMIN; Order must be executed)' })
  create(@Body() dto: CreateKickoffDto, @CurrentUser() user: AuthenticatedUser) {
    return this.service.create(dto, user);
  }

  @Get()
  @ApiOperation({ summary: 'Kickoffs the caller can access' })
  findAll(@CurrentUser() user: AuthenticatedUser) {
    return this.service.findAll(user);
  }

  // Declared before :id so "eligible-orders" isn't captured as an id param.
  @Get('eligible-orders')
  @ApiOperation({
    summary:
      'Orders eligible for a new kickoff (executed sheet, no kickoff yet) — PM/SUPER_ADMIN',
  })
  eligibleOrders(@CurrentUser() user: AuthenticatedUser) {
    return this.service.eligibleOrders(user);
  }

  @Get(':id')
  @ApiOperation({ summary: 'One kickoff with all sub-records' })
  findOne(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.service.findOne(id, user);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Edit kickoff header fields / status' })
  update(
    @Param('id') id: string,
    @Body() dto: UpdateKickoffDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.update(id, dto, user);
  }

  // ── Attendees ──────────────────────────────────────────────────────
  @Post(':id/attendees')
  @ApiOperation({ summary: 'Add an attendee (internal or external)' })
  addAttendee(
    @Param('id') id: string,
    @Body() dto: CreateAttendeeDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.addAttendee(id, dto, user);
  }

  @Delete(':id/attendees/:attendeeId')
  @HttpCode(204)
  @ApiOperation({ summary: 'Remove an attendee' })
  async removeAttendee(
    @Param('id') id: string,
    @Param('attendeeId') attendeeId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    await this.service.removeAttendee(id, attendeeId, user);
  }

  // ── Milestones ─────────────────────────────────────────────────────
  @Post(':id/milestones')
  @ApiOperation({ summary: 'Add a milestone' })
  addMilestone(
    @Param('id') id: string,
    @Body() dto: CreateMilestoneDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.addMilestone(id, dto, user);
  }

  @Patch(':id/milestones/:milestoneId')
  @ApiOperation({ summary: 'Edit a milestone' })
  updateMilestone(
    @Param('id') id: string,
    @Param('milestoneId') milestoneId: string,
    @Body() dto: UpdateMilestoneDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.updateMilestone(id, milestoneId, dto, user);
  }

  @Delete(':id/milestones/:milestoneId')
  @HttpCode(204)
  @ApiOperation({ summary: 'Delete a milestone' })
  async removeMilestone(
    @Param('id') id: string,
    @Param('milestoneId') milestoneId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    await this.service.removeMilestone(id, milestoneId, user);
  }

  // ── Action items ───────────────────────────────────────────────────
  @Post(':id/action-items')
  @ApiOperation({ summary: 'Add an action item (auto-creates a Kanban card for the owner)' })
  addActionItem(
    @Param('id') id: string,
    @Body() dto: CreateActionItemDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.addActionItem(id, dto, user);
  }

  @Patch(':id/action-items/:actionItemId')
  @ApiOperation({ summary: 'Edit an action item (syncs the linked card title/due date)' })
  updateActionItem(
    @Param('id') id: string,
    @Param('actionItemId') actionItemId: string,
    @Body() dto: UpdateActionItemDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.updateActionItem(id, actionItemId, dto, user);
  }

  @Delete(':id/action-items/:actionItemId')
  @HttpCode(204)
  @ApiOperation({ summary: 'Delete an action item (archives the linked card)' })
  async removeActionItem(
    @Param('id') id: string,
    @Param('actionItemId') actionItemId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    await this.service.removeActionItem(id, actionItemId, user);
  }

  // ── Risks ──────────────────────────────────────────────────────────
  @Post(':id/risks')
  @ApiOperation({ summary: 'Add a risk' })
  addRisk(
    @Param('id') id: string,
    @Body() dto: CreateRiskDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.addRisk(id, dto, user);
  }

  @Patch(':id/risks/:riskId')
  @ApiOperation({ summary: 'Edit a risk' })
  updateRisk(
    @Param('id') id: string,
    @Param('riskId') riskId: string,
    @Body() dto: UpdateRiskDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.updateRisk(id, riskId, dto, user);
  }

  @Delete(':id/risks/:riskId')
  @HttpCode(204)
  @ApiOperation({ summary: 'Delete a risk' })
  async removeRisk(
    @Param('id') id: string,
    @Param('riskId') riskId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    await this.service.removeRisk(id, riskId, user);
  }

  // ── Delivery classification (per order line item) ──────────────────
  @Patch(':id/delivery-items/:lineItemId')
  @ApiOperation({
    summary:
      'Set a line item’s delivery type + vendor placeholder fields (kickoff access)',
  })
  updateDeliveryItem(
    @Param('id') id: string,
    @Param('lineItemId') lineItemId: string,
    @Body() dto: UpdateDeliveryItemDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.updateDeliveryItem(id, lineItemId, dto, user);
  }
}
