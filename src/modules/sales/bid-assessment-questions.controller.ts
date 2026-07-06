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
import { CreateBidAssessmentQuestionDto } from './dto/create-bid-assessment-question.dto';
import { UpdateBidAssessmentQuestionDto } from './dto/update-bid-assessment-question.dto';
import { BidAssessmentQuestionsService } from './bid-assessment-questions.service';

/**
 * Admin-managed configurable Bid/No-Bid questionnaire. Only ADMIN/SUPER_ADMIN
 * manage the list; Sales reps read the active set through the assessment
 * submission flow (they don't need this controller directly, but GET is left
 * open to the same roles as management for the Admin UI).
 */
@ApiTags('bid-assessment-questions')
@ApiBearerAuth()
@UseGuards(RolesGuard)
@Roles(Role.ADMIN, Role.SUPER_ADMIN)
@Controller('bid-assessment-questions')
export class BidAssessmentQuestionsController {
  constructor(private readonly service: BidAssessmentQuestionsService) {}

  @Post()
  @ApiOperation({ summary: 'Add a Bid/No-Bid assessment question' })
  create(@Body() dto: CreateBidAssessmentQuestionDto) {
    return this.service.create(dto);
  }

  @Get()
  // Sales reps must read the active question set to fill in an assessment, so
  // GET is broader than the Admin-only create/update below. includeInactive
  // (Admin management view) is only honoured for ADMIN/SUPER_ADMIN — see below.
  @Roles(Role.MANAGER, Role.EMPLOYEE, Role.ADMIN, Role.SUPER_ADMIN)
  @ApiOperation({
    summary: 'List assessment questions (pass includeInactive=true for all)',
  })
  findAll(
    @CurrentUser() user: AuthenticatedUser,
    @Query('includeInactive') includeInactive?: string,
  ) {
    // Only Admins may see inactive questions; a rep always gets the active set.
    const isAdmin =
      user.role === Role.ADMIN || user.role === Role.SUPER_ADMIN;
    return this.service.findAll(isAdmin && includeInactive === 'true');
  }

  @Patch(':id')
  @ApiOperation({
    summary: 'Edit / reorder / (de)activate an assessment question',
  })
  update(@Param('id') id: string, @Body() dto: UpdateBidAssessmentQuestionDto) {
    return this.service.update(id, dto);
  }
}
