import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsString,
  IsUUID,
  MinLength,
  ValidateNested,
} from 'class-validator';

export class BidAssessmentAnswerDto {
  @ApiProperty({ description: 'The question being answered' })
  @IsUUID()
  questionId!: string;

  @ApiProperty({
    description:
      'The answer as text regardless of question type (parsed per type on display)',
  })
  @IsString()
  @MinLength(1)
  answerValue!: string;
}

export class SubmitBidAssessmentDto {
  @ApiProperty({ type: [BidAssessmentAnswerDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => BidAssessmentAnswerDto)
  answers!: BidAssessmentAnswerDto[];
}
