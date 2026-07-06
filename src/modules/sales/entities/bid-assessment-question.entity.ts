import { ApiProperty } from '@nestjs/swagger';
import { BidAssessmentQuestionType } from '@prisma/client';

export class BidAssessmentQuestionEntity {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  text!: string;

  @ApiProperty({ enum: BidAssessmentQuestionType })
  type!: BidAssessmentQuestionType;

  @ApiProperty({ type: [String], nullable: true })
  options!: string[] | null;

  @ApiProperty()
  displayOrder!: number;

  @ApiProperty()
  isActive!: boolean;

  @ApiProperty()
  createdAt!: Date;

  @ApiProperty()
  updatedAt!: Date;

  constructor(partial: Partial<BidAssessmentQuestionEntity>) {
    Object.assign(this, partial);
  }
}
