import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';

/**
 * Reviewer comments. Optional on approve; the service requires a non-empty
 * value on reject (a bare rejection with no reasoning is useless feedback).
 */
export class ReviewBidAssessmentDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  reviewerComments?: string;
}
