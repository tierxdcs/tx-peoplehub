import { ApiProperty } from '@nestjs/swagger';
import { BidAssessmentStatus, SignatureFont } from '@prisma/client';

export class BidAssessmentResponseEntity {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  questionId!: string;

  @ApiProperty({ description: 'Question wording as asked at submission time' })
  questionTextSnapshot!: string;

  @ApiProperty()
  answerValue!: string;

  constructor(partial: Partial<BidAssessmentResponseEntity>) {
    Object.assign(this, partial);
  }
}

export class BidDecisionAssessmentEntity {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  opportunityId!: string;

  @ApiProperty()
  submittedById!: string;

  @ApiProperty({ enum: BidAssessmentStatus })
  status!: BidAssessmentStatus;

  @ApiProperty({ nullable: true })
  reviewedById!: string | null;

  @ApiProperty({ nullable: true })
  reviewedAt!: Date | null;

  @ApiProperty({ nullable: true })
  reviewerComments!: string | null;

  @ApiProperty({ nullable: true })
  approverSignatureTextSnapshot!: string | null;

  @ApiProperty({ enum: SignatureFont, nullable: true })
  approverSignatureFontSnapshot!: SignatureFont | null;

  @ApiProperty({ type: [BidAssessmentResponseEntity], required: false })
  responses?: BidAssessmentResponseEntity[];

  @ApiProperty()
  createdAt!: Date;

  @ApiProperty()
  updatedAt!: Date;

  constructor(partial: Partial<BidDecisionAssessmentEntity>) {
    Object.assign(this, partial);
  }
}
