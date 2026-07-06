import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
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
import { PaginationQueryDto } from '../../common/dto/pagination.dto';
import { SubmitBidAssessmentDto } from './dto/submit-bid-assessment.dto';
import { ReviewBidAssessmentDto } from './dto/review-bid-assessment.dto';
import { BidAssessmentsService } from './bid-assessments.service';

/**
 * Bid/No-Bid decision gate endpoints. No controller prefix so the submit
 * route can live under /opportunities/:id/bid-assessment (owner action) while
 * review routes live under /bid-assessments (reviewer actions). Sales-vertical
 * roles at the guard; finer rules (owner scope, Sales-Head-or-SuperAdmin
 * review) are enforced in the service.
 */
@ApiTags('bid-assessments')
@ApiBearerAuth()
@UseGuards(RolesGuard)
@Roles(Role.MANAGER, Role.EMPLOYEE, Role.SUPER_ADMIN)
@Controller()
export class BidAssessmentsController {
  constructor(private readonly service: BidAssessmentsService) {}

  @Post('opportunities/:id/bid-assessment')
  @ApiOperation({
    summary: 'Submit a Bid/No-Bid assessment for an opportunity (owner)',
  })
  submit(
    @Param('id') opportunityId: string,
    @Body() dto: SubmitBidAssessmentDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.submit(opportunityId, dto, user);
  }

  @Get('opportunities/:id/bid-assessments')
  @ApiOperation({
    summary:
      'All assessments for an opportunity, most-recent first (gate state)',
  })
  findForOpportunity(
    @Param('id') opportunityId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.findForOpportunity(opportunityId, user);
  }

  @Get('bid-assessments/pending-approval')
  @ApiOperation({
    summary:
      'Assessments awaiting review (the designated Sales Head, or SUPER_ADMIN)',
  })
  findPendingApproval(
    @Query() query: PaginationQueryDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.findPendingApproval(query, user);
  }

  @Get('bid-assessments/:id')
  @ApiOperation({ summary: 'View one assessment with its snapshotted answers' })
  findOne(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.service.findOne(id, user);
  }

  @Patch('bid-assessments/:id/approve')
  @ApiOperation({
    summary: 'Approve an assessment (Sales Head or SUPER_ADMIN)',
  })
  approve(
    @Param('id') id: string,
    @Body() dto: ReviewBidAssessmentDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.approve(id, dto, user);
  }

  @Patch('bid-assessments/:id/reject')
  @ApiOperation({
    summary:
      'Reject an assessment (comments required; Sales Head or SUPER_ADMIN)',
  })
  reject(
    @Param('id') id: string,
    @Body() dto: ReviewBidAssessmentDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.reject(id, dto, user);
  }
}
