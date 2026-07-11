import { ApiProperty } from '@nestjs/swagger';

/**
 * Pending-approval counts across all five approval surfaces. Every key is
 * always present — a category that doesn't apply to the caller's role returns
 * 0 (never omitted), so the frontend can treat the shape uniformly.
 */
export class PendingCountsEntity {
  @ApiProperty({ description: "Leave requests awaiting the caller's approval" })
  leaveApprovals!: number;

  @ApiProperty({ description: 'Bids (>10% discount) awaiting the caller' })
  bidDiscountApprovals!: number;

  @ApiProperty({ description: 'Bid/No-Bid assessments awaiting review' })
  bidAssessmentApprovals!: number;

  @ApiProperty({ description: 'Employees awaiting an access grant' })
  hrPendingAccess!: number;

  @ApiProperty({
    description: 'Confirmation sheets awaiting internal countersignature',
  })
  confirmationSheetsPending!: number;

  constructor(partial: Partial<PendingCountsEntity>) {
    Object.assign(this, partial);
  }
}
