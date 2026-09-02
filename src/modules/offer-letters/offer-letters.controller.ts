import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import {
  AuthenticatedUser,
  CurrentUser,
} from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { OfferLetterDecisionDto } from './dto/offer-letter-decision.dto';
import { DeclineOfferLetterDto } from './dto/offer-letter-response.dto';
import { SaveOfferLetterDto } from './dto/save-offer-letter.dto';
import { OfferLettersService } from './offer-letters.service';

@ApiTags('offer-letters')
@ApiBearerAuth()
@Controller('offer-letters')
@Roles(Role.MANAGER, Role.ADMIN, Role.SUPER_ADMIN)
export class OfferLettersController {
  constructor(private readonly service: OfferLettersService) {}

  @Get()
  @ApiOperation({ summary: 'List saved offer-letter records' })
  list(@CurrentUser() user: AuthenticatedUser) {
    return this.service.list(user);
  }

  // Declared before the parameterized routes so it is never shadowed by ':id'.
  // The approval-facing routes (this + review/approve/reject) override the
  // class role gate to admit EMPLOYEE too: a vertical owner may hold any role,
  // and these routes self-authorize by identity (pendingApprovalWhere /
  // assertCanDecide) rather than by role.
  @Get('pending-approval')
  @Roles(Role.EMPLOYEE, Role.MANAGER, Role.ADMIN, Role.SUPER_ADMIN)
  @ApiOperation({
    summary: 'Offer letters awaiting the current user’s approval',
  })
  listPendingApproval(@CurrentUser() user: AuthenticatedUser) {
    return this.service.listPendingApproval(user);
  }

  // Also declared before ':id'. The starting point of the whole flow: applicants
  // selected at interview who are waiting for an offer.
  @Get('candidates-awaiting-offer')
  @ApiOperation({
    summary: 'Selected candidates with no live offer letter yet',
  })
  listCandidatesAwaitingOffer(@CurrentUser() user: AuthenticatedUser) {
    return this.service.listCandidatesAwaitingOffer(user);
  }

  @Post()
  @ApiOperation({ summary: 'Create or update authored offer-letter content' })
  save(
    @Body() dto: SaveOfferLetterDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.save(dto, user);
  }

  @Get('employee/:employeeId')
  @ApiOperation({
    summary:
      'Resolve a legacy employee-anchored offer letter — live data while DRAFT/REJECTED, frozen snapshot once submitted',
  })
  getForEmployee(
    @Param('employeeId') employeeId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.getForEmployee(employeeId, user);
  }

  @Get(':id')
  @ApiOperation({
    summary:
      'Resolve an offer letter by id — live data while DRAFT/REJECTED, frozen snapshot once submitted',
  })
  getById(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.service.getById(id, user);
  }

  @Post(':id/submit')
  @ApiOperation({
    summary:
      'Submit an offer letter for vertical-owner approval (freezes a snapshot)',
  })
  submit(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.service.submit(id, user);
  }

  @Post(':id/send')
  @ApiOperation({
    summary:
      'Record that the approved offer has gone out to the candidate (moves the requisition to Offer Extended)',
  })
  send(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.service.send(id, user);
  }

  @Post(':id/accept')
  @ApiOperation({
    summary:
      'Record the candidate’s acceptance — this is what authorizes onboarding',
  })
  accept(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.service.accept(id, user);
  }

  @Post(':id/decline')
  @ApiOperation({
    summary:
      'Record that the candidate declined, releasing the requisition for another applicant',
  })
  decline(
    @Param('id') id: string,
    @Body() dto: DeclineOfferLetterDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.decline(id, dto, user);
  }

  @Get(':id/review')
  @Roles(Role.EMPLOYEE, Role.MANAGER, Role.ADMIN, Role.SUPER_ADMIN)
  @ApiOperation({
    summary:
      'Fetch a submitted offer letter for the approver (vertical owner / Super Admin)',
  })
  reviewForApproval(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.reviewForApproval(id, user);
  }

  @Post(':id/approve')
  @Roles(Role.EMPLOYEE, Role.MANAGER, Role.ADMIN, Role.SUPER_ADMIN)
  @ApiOperation({ summary: 'Approve a submitted offer letter' })
  approve(
    @Param('id') id: string,
    @Body() dto: OfferLetterDecisionDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.approve(id, dto, user);
  }

  @Post(':id/reject')
  @Roles(Role.EMPLOYEE, Role.MANAGER, Role.ADMIN, Role.SUPER_ADMIN)
  @ApiOperation({
    summary: 'Reject a submitted offer letter (comment required)',
  })
  reject(
    @Param('id') id: string,
    @Body() dto: OfferLetterDecisionDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.reject(id, dto, user);
  }
}
