import { PartialType } from '@nestjs/swagger';
import { CreateBidAssessmentQuestionDto } from './create-bid-assessment-question.dto';

/**
 * All fields optional — Admin can edit wording, reorder, toggle isActive
 * (deactivate rather than delete, so answered history keeps referencing the
 * question row), or change options.
 */
export class UpdateBidAssessmentQuestionDto extends PartialType(
  CreateBidAssessmentQuestionDto,
) {}
