import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RfqStatus, Role } from '@prisma/client';
import {
  AuthenticatedUser,
  CurrentUser,
} from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { RolesGuard } from '../../common/guards/roles.guard';
import { RfqService } from './rfq.service';
import {
  AddInviteeDto,
  AwardRfqDto,
  ComparisonWeightsDto,
  CreateRfqDto,
  RejectRfqDto,
  UpdateRfqDto,
  RfqAttachmentConfirmDto,
  RfqAttachmentUploadUrlDto,
} from './dto/rfq.dto';
import { RfqTechnicalService } from './rfq-technical.service';

/**
 * RFQ Builder (SCM). Coarse @Roles keeps unauthenticated/foreign roles off;
 * the fine SCM-Manager+/PM gates and the sealed-bid rule live in the service.
 */
@ApiTags('rfq')
@ApiBearerAuth()
@UseGuards(RolesGuard)
@Roles(Role.MANAGER, Role.EMPLOYEE, Role.ADMIN, Role.SUPER_ADMIN)
@Controller('rfqs')
export class RfqController {
  constructor(
    private readonly service: RfqService,
    private readonly technical: RfqTechnicalService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'List RFQs (SCM read)' })
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Query('status') status?: RfqStatus,
  ) {
    return this.service.list(user, { status });
  }

  @Get('project-options')
  @ApiOperation({
    summary: 'List projects and their linked order context for RFQ creation',
  })
  projectOptions(@CurrentUser() user: AuthenticatedUser) {
    return this.service.projectOptions(user);
  }

  @Get('project-options/:projectKickoffId/sourcing-lines')
  @ApiOperation({
    summary: 'Exploded BUY requirements for an order-linked RFQ',
  })
  sourcingLines(
    @Param('projectKickoffId') projectKickoffId: string,
    @Query('excludedOrderLineIds') excludedOrderLineIds: string | undefined,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.sourcingLines(
      projectKickoffId,
      excludedOrderLineIds?.split(',').filter(Boolean) ?? [],
      user,
    );
  }

  @Post()
  @ApiOperation({ summary: 'Create a DRAFT RFQ (SCM Manager+/SA)' })
  create(@Body() dto: CreateRfqDto, @CurrentUser() user: AuthenticatedUser) {
    return this.service.create(dto, user);
  }

  @Post('from-kickoff/:kickoffId')
  @ApiOperation({
    summary: 'Generate a DRAFT RFQ from a kickoff’s stock shortfalls',
  })
  fromKickoff(
    @Param('kickoffId') kickoffId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.createFromKickoffShortfall(kickoffId, user);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get an RFQ (SCM read; quote values not included)' })
  get(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.service.get(id, user);
  }

  @Get(':id/technical-documents')
  technicalDocuments(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.technical.internalView(id, user);
  }

  @Post(':id/technical-attachments/upload-url')
  technicalUploadUrl(
    @Param('id') id: string,
    @Body() dto: RfqAttachmentUploadUrlDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.technical.uploadUrl(id, dto, user);
  }

  @Post(':id/technical-attachments/confirm')
  technicalConfirm(
    @Param('id') id: string,
    @Body() dto: RfqAttachmentConfirmDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.technical.confirm(id, dto, user);
  }

  @Post(':id/technical-attachments/:attachmentId/download')
  technicalDownload(
    @Param('id') id: string,
    @Param('attachmentId') attachmentId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.technical.internalDownload(id, attachmentId, user);
  }

  @Delete(':id/technical-attachments/:attachmentId')
  @ApiOperation({
    summary: 'Delete an RFQ technical attachment and its R2 object',
  })
  technicalDelete(
    @Param('id') id: string,
    @Param('attachmentId') attachmentId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.technical.remove(id, attachmentId, user);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Edit a DRAFT RFQ (SCM Manager+/SA)' })
  update(
    @Param('id') id: string,
    @Body() dto: UpdateRfqDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.update(id, dto, user);
  }

  @Post(':id/invitees')
  @ApiOperation({
    summary: 'Add an invitee (supplier XOR vendor); warns if unqualified',
  })
  addInvitee(
    @Param('id') id: string,
    @Body() dto: AddInviteeDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.addInvitee(id, dto, user);
  }

  @Delete(':id/invitees/:inviteeId')
  @ApiOperation({ summary: 'Remove an invitee from a DRAFT RFQ' })
  removeInvitee(
    @Param('id') id: string,
    @Param('inviteeId') inviteeId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.removeInvitee(id, inviteeId, user);
  }

  @Post(':id/approve')
  @ApiOperation({
    summary:
      'Approve a DRAFT RFQ (assigned PM/SA; never its own creator). Clears the issue gate.',
  })
  approve(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.service.approve(id, user);
  }

  @Post(':id/reject')
  @ApiOperation({
    summary:
      'Reject a DRAFT RFQ with a required comment (returns it to editable state)',
  })
  reject(
    @Param('id') id: string,
    @Body() dto: RejectRfqDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.reject(id, dto.comment, user);
  }

  @Post(':id/issue')
  @ApiOperation({
    summary:
      'Issue the RFQ (requires PM approval + ≥3 invitees; generates tokens)',
  })
  issue(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.service.issue(id, user);
  }

  @Post(':id/close')
  @ApiOperation({
    summary: 'Close an ISSUED RFQ early (quotes then become visible)',
  })
  close(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.service.close(id, user);
  }

  @Post(':id/cancel')
  @ApiOperation({ summary: 'Cancel an RFQ (not once awarded)' })
  cancel(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.service.cancel(id, user);
  }

  @Get(':id/comparison')
  @ApiOperation({
    summary:
      'Quote comparison (sealed until close) with advisory weighted score',
  })
  comparison(
    @Param('id') id: string,
    @Query() weights: ComparisonWeightsDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.comparison(id, weights, user);
  }

  @Post(':id/award')
  @ApiOperation({
    summary:
      'Award to an invitee (PM/SA); justification required if not lowest. Pre-fills a DRAFT PO.',
  })
  award(
    @Param('id') id: string,
    @Body() dto: AwardRfqDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.award(id, dto, user);
  }
}
