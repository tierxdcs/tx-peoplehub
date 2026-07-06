import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { BidAssessmentQuestionType } from '@prisma/client';
import {
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Min,
  MinLength,
} from 'class-validator';

export class CreateBidAssessmentQuestionDto {
  @ApiProperty({ description: 'The question as shown to the rep' })
  @IsString()
  @MinLength(1)
  text!: string;

  @ApiProperty({ enum: BidAssessmentQuestionType })
  @IsEnum(BidAssessmentQuestionType)
  type!: BidAssessmentQuestionType;

  @ApiPropertyOptional({
    description: 'Option strings — required (and only used) for SELECT type',
    type: [String],
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  options?: string[];

  @ApiPropertyOptional({ default: 0 })
  @IsOptional()
  @IsInt()
  @Min(0)
  displayOrder?: number;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
