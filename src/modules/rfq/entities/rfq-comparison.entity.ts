import { ApiProperty } from '@nestjs/swagger';
import { RfqQuoteStatus } from '@prisma/client';

/** One invitee's line-level quote in the comparison grid. */
export class ComparisonQuoteLineEntity {
  @ApiProperty() rfqLineId!: string;
  @ApiProperty({ nullable: true }) unitPrice!: string | null;
  @ApiProperty({ nullable: true }) lineTotal!: string | null;
  @ApiProperty({
    description: 'True if this is the lowest unit price for the line',
  })
  isLowestUnitPrice!: boolean;

  constructor(p: Partial<ComparisonQuoteLineEntity>) {
    Object.assign(this, p);
  }
}

/** One submitted revision in an invitee's negotiation history. */
export class ComparisonRevisionEntity {
  @ApiProperty({ description: '1 = the original sealed submission' })
  revisionNumber!: number;
  @ApiProperty({ nullable: true }) submittedAt!: string | null;
  @ApiProperty() totalQuotedValue!: string;
  @ApiProperty({ nullable: true }) quotedLeadTimeDays!: number | null;

  constructor(p: Partial<ComparisonRevisionEntity>) {
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
  @ApiProperty({
    description: 'True when this invitee never submitted a quote',
  })
  nonResponder!: boolean;
  @ApiProperty({ nullable: true }) declineReason!: string | null;

  @ApiProperty({ nullable: true }) totalQuotedValue!: string | null;
  @ApiProperty({
    nullable: true,
    description: 'Absolute variance vs the lowest total',
  })
  varianceVsLowest!: string | null;
  @ApiProperty({
    nullable: true,
    description: 'Percent variance vs the lowest total',
  })
  variancePctVsLowest!: string | null;
  @ApiProperty({
    description: 'True if this is the lowest total among responders',
  })
  isLowestTotal!: boolean;

  /**
   * The lead time compared and scored on: the quote's own summary figure, or the
   * slowest of its per-line delivery lead times when the summary was left blank.
   */
  @ApiProperty({ nullable: true }) quotedLeadTimeDays!: number | null;
  @ApiProperty({
    description: 'True when the lead time was derived from the quote lines',
  })
  leadTimeFromLines!: boolean;
  @ApiProperty({ nullable: true }) paymentTermsOffered!: string | null;
  @ApiProperty({ nullable: true }) validityDays!: number | null;
  @ApiProperty({ description: 'R2 attachment keys on the quote' })
  attachmentFileKeys!: string[];

  /** Advisory weighted score (0-100). Null for non-responders. */
  @ApiProperty({ nullable: true }) weightedScore!: string | null;

  /**
   * The revision every figure in this column is taken from — the latest one the
   * invitee submitted. Null for a non-responder.
   */
  @ApiProperty({ nullable: true }) revisionNumber!: number | null;
  /** Every submitted revision, newest first, so the negotiation is auditable. */
  @ApiProperty({ type: [ComparisonRevisionEntity] })
  revisions!: ComparisonRevisionEntity[];

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
  @ApiProperty({
    description: 'Weights actually applied (price/leadTime/qualification)',
  })
  weights!: { price: number; leadTime: number; qualification: number };
  @ApiProperty() lines!: {
    rfqLineId: string;
    itemCode: string | null;
    itemName: string | null;
    quantity: string;
    unitOfMeasure: string;
  }[];
  @ApiProperty({ type: [ComparisonColumnEntity] })
  columns!: ComparisonColumnEntity[];

  constructor(p: Partial<RfqComparisonEntity>) {
    Object.assign(this, p);
  }
}
