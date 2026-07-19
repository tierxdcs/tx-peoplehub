import { ApiProperty } from '@nestjs/swagger';
import { RfqQuoteStatus } from '@prisma/client';

/** One invitee's line-level quote in the comparison grid. */
export class ComparisonQuoteLineEntity {
  @ApiProperty() rfqLineId!: string;
  @ApiProperty({ nullable: true }) unitPrice!: string | null;
  @ApiProperty({ nullable: true }) lineTotal!: string | null;
  @ApiProperty({ description: 'True if this is the lowest unit price for the line' })
  isLowestUnitPrice!: boolean;

  constructor(p: Partial<ComparisonQuoteLineEntity>) {
    Object.assign(this, p);
  }
}

/** One column of the comparison — a single invitee (responder or not). */
export class ComparisonColumnEntity {
  @ApiProperty() inviteeId!: string;
  @ApiProperty() partnerType!: 'SUPPLIER' | 'VENDOR';
  @ApiProperty({ nullable: true }) partnerName!: string | null;
  @ApiProperty() qualificationStatusSnapshot!: string;
  @ApiProperty({ enum: RfqQuoteStatus }) quoteStatus!: RfqQuoteStatus;
  @ApiProperty({ description: 'True when this invitee never submitted a quote' })
  nonResponder!: boolean;
  @ApiProperty({ nullable: true }) declineReason!: string | null;

  @ApiProperty({ nullable: true }) totalQuotedValue!: string | null;
  @ApiProperty({ nullable: true, description: 'Absolute variance vs the lowest total' })
  varianceVsLowest!: string | null;
  @ApiProperty({ nullable: true, description: 'Percent variance vs the lowest total' })
  variancePctVsLowest!: string | null;
  @ApiProperty({ description: 'True if this is the lowest total among responders' })
  isLowestTotal!: boolean;

  @ApiProperty({ nullable: true }) quotedLeadTimeDays!: number | null;
  @ApiProperty({ nullable: true }) paymentTermsOffered!: string | null;
  @ApiProperty({ nullable: true }) validityDays!: number | null;
  @ApiProperty({ description: 'R2 attachment keys on the quote' })
  attachmentFileKeys!: string[];

  /** Advisory weighted score (0-100). Null for non-responders. */
  @ApiProperty({ nullable: true }) weightedScore!: string | null;

  @ApiProperty({ type: [ComparisonQuoteLineEntity] })
  lines!: ComparisonQuoteLineEntity[];

  constructor(p: Partial<ComparisonColumnEntity>) {
    Object.assign(this, p);
  }
}

export class RfqComparisonEntity {
  @ApiProperty() rfqId!: string;
  @ApiProperty() rfqNumber!: string;
  @ApiProperty() status!: string;
  @ApiProperty({ description: 'Weights actually applied (price/leadTime/qualification)' })
  weights!: { price: number; leadTime: number; qualification: number };
  @ApiProperty() lines!: { rfqLineId: string; itemCode: string | null; itemName: string | null; quantity: string; unitOfMeasure: string }[];
  @ApiProperty({ type: [ComparisonColumnEntity] })
  columns!: ComparisonColumnEntity[];

  constructor(p: Partial<RfqComparisonEntity>) {
    Object.assign(this, p);
  }
}
