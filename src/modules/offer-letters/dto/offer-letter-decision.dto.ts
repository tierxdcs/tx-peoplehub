import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';

/**
 * Vertical owner's approve/reject decision on a submitted offer letter.
 * Comment is optional on approve; the service REQUIRES a non-empty value on
 * reject (a bare rejection with no reasoning is useless feedback — matches
 * every other rejection gate in this system).
 */
export class OfferLetterDecisionDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  approverComments?: string;
}
