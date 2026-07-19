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
  UpdateRfqDto,
} from './dto/rfq.dto';

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
  constructor(private readonly service: RfqService) {}

  @Get()
  @ApiOperation({ summary: 'List RFQs (SCM read)' })
  list(@CurrentUser() user: AuthenticatedUser, @Query('status') status?: RfqStatus) {
    return this.service.list(user, { status });
  }

  @Post()
  @ApiOperation({ summary: 'Create a DRAFT RFQ (SCM Manager+/SA)' })
  create(@Body() dto: CreateRfqDto, @CurrentUser() user: AuthenticatedUser) {
    return this.service.create(dto, user);
  }

  @Post('from-kickoff/:kickoffId')
  @ApiOperation({ summary: 'Generate a DRAFT RFQ from a kickoff’s stock shortfalls' })
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
  @ApiOperation({ summary: 'Add an invitee (supplier XOR vendor); warns if unqualified' })
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

  @Post(':id/issue')
  @ApiOperation({ summary: 'Issue the RFQ (requires ≥3 invitees; generates tokens)' })
  issue(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.service.issue(id, user);
  }

  @Post(':id/close')
  @ApiOperation({ summary: 'Close an ISSUED RFQ early (quotes then become visible)' })
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
    summary: 'Quote comparison (sealed until close) with advisory weighted score',
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
    summary: 'Award to an invitee (PM/SA); justification required if not lowest. Pre-fills a DRAFT PO.',
  })
  award(
    @Param('id') id: string,
    @Body() dto: AwardRfqDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.award(id, dto, user);
  }
}
