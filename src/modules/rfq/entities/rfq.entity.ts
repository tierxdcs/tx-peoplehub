import { ApiProperty } from '@nestjs/swagger';
import { RfqQuoteStatus, RfqStatus } from '@prisma/client';

export class RfqLineEntity {
  @ApiProperty() id!: string;
  @ApiProperty() itemId!: string;
  @ApiProperty({ nullable: true }) itemCode!: string | null;
  @ApiProperty({ nullable: true }) itemName!: string | null;
  @ApiProperty() quantity!: string;
  @ApiProperty() unitOfMeasure!: string;
  @ApiProperty({ nullable: true }) specificationNotes!: string | null;
  @ApiProperty({ nullable: true }) targetPrice!: string | null;
  @ApiProperty() sequence!: number;

  constructor(p: Partial<RfqLineEntity>) {
    Object.assign(this, p);
  }
}

/** Public/SCM-safe invitee shape. Quote values are NEVER included here while
 *  the RFQ is sealed — the comparison entity carries those, and only post-close. */
export class RfqInviteeEntity {
  @ApiProperty() id!: string;
  @ApiProperty({ nullable: true }) supplierId!: string | null;
  @ApiProperty({ nullable: true }) vendorId!: string | null;
  @ApiProperty() partnerType!: 'SUPPLIER' | 'VENDOR';
  @ApiProperty({ nullable: true }) partnerName!: string | null;
  @ApiProperty() qualificationStatusSnapshot!: string;
  @ApiProperty({ enum: RfqQuoteStatus }) quoteStatus!: RfqQuoteStatus;
  @ApiProperty({ nullable: true }) submittedAt!: string | null;
  @ApiProperty({ nullable: true }) declineReason!: string | null;
  @ApiProperty({ nullable: true }) revokedAt!: string | null;
  /** Present to managers so they can hand the link to the vendor manually. */
  @ApiProperty({ nullable: true }) inviteToken!: string | null;

  constructor(p: Partial<RfqInviteeEntity>) {
    Object.assign(this, p);
  }
}

export class RfqEntity {
  @ApiProperty() id!: string;
  @ApiProperty() rfqNumber!: string;
  @ApiProperty() title!: string;
  @ApiProperty({ nullable: true }) description!: string | null;
  @ApiProperty({ enum: RfqStatus }) status!: RfqStatus;
  @ApiProperty({ nullable: true }) projectKickoffId!: string | null;
  @ApiProperty({ nullable: true }) projectName!: string | null;
  @ApiProperty({ nullable: true }) orderId!: string | null;
  @ApiProperty({ nullable: true }) orderNumber!: string | null;
  @ApiProperty({ nullable: true }) orderStatus!: string | null;
  @ApiProperty({ nullable: true }) orderTotal!: string | null;
  @ApiProperty({ nullable: true }) customerName!: string | null;
  @ApiProperty({ type: [Object] }) orderLines!: Array<{
    orderLineId: string;
    productSku: string;
    productName: string;
    quantity: string;
    unitOfMeasure: string;
    unitPrice: string;
    lineTotal: string;
  }>;
  @ApiProperty() submissionDeadline!: string;
  @ApiProperty({ nullable: true }) requiredByDate!: string | null;
  @ApiProperty({ nullable: true }) deliveryLocation!: string | null;
  @ApiProperty({ nullable: true }) paymentTermsRequested!: string | null;

  @ApiProperty({ nullable: true }) awardedInviteeId!: string | null;
  @ApiProperty({ nullable: true }) awardDecisionByName!: string | null;
  @ApiProperty({ nullable: true }) awardDecisionAt!: string | null;
  @ApiProperty({ nullable: true }) awardJustification!: string | null;

  @ApiProperty() createdById!: string;
  @ApiProperty({ nullable: true }) createdByName!: string | null;

  // ── Project Manager approval gate (before invitee links are generated) ──
  /** True once a PM (or SUPER_ADMIN) has approved — the issue gate is cleared. */
  @ApiProperty() pmApproved!: boolean;
  @ApiProperty({ nullable: true }) pmApprovedByName!: string | null;
  @ApiProperty({ nullable: true }) pmApprovedAt!: string | null;
  /** Present after a rejection; cleared on the next approval. */
  @ApiProperty({ nullable: true }) pmRejectionComment!: string | null;
  /** Designated Project Manager(s) whose approval the RFQ awaits (for the UI message). */
  @ApiProperty({ nullable: true }) pmApproverName!: string | null;
  /** True when the CURRENT viewer may approve/reject this RFQ right now. */
  @ApiProperty() canApprove!: boolean;

  @ApiProperty({ type: [RfqLineEntity] }) lines!: RfqLineEntity[];
  @ApiProperty({ type: [RfqInviteeEntity] }) invitees!: RfqInviteeEntity[];

  /** True once past the sealed phase — the UI/service may show quote values. */
  @ApiProperty() quotesVisible!: boolean;

  @ApiProperty() createdAt!: string;
  @ApiProperty() updatedAt!: string;

  constructor(p: Partial<RfqEntity>) {
    Object.assign(this, p);
  }
}
