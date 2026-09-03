import { ApiProperty } from '@nestjs/swagger';
import { ApPaymentStatus, PurchaseOrderStatus } from '@prisma/client';

export class PurchaseOrderLineEntity {
  @ApiProperty() id!: string;
  @ApiProperty({ nullable: true }) itemId!: string | null;
  @ApiProperty({ nullable: true }) itemCode!: string | null;
  @ApiProperty() itemName!: string;
  @ApiProperty({ nullable: true }) adHocDescription!: string | null;
  @ApiProperty({ description: 'Decimal serialized as string' })
  orderedQuantity!: string;
  @ApiProperty({ description: 'Decimal serialized as string' })
  unitPrice!: string;
  @ApiProperty() unitOfMeasure!: string;
  @ApiProperty({ description: 'orderedQuantity × unitPrice' })
  lineTotal!: string;
  @ApiProperty({ nullable: true }) notes!: string | null;
  @ApiProperty() sequence!: number;

  constructor(p: Partial<PurchaseOrderLineEntity>) {
    Object.assign(this, p);
  }
}

/**
 * A qualification warning surfaced when the PO's supplier/vendor is not in an
 * APPROVED / APPROVED_PREFERRED state. Warning ONLY — the PO is still created
 * (emergency purchases are legitimate). Deliberately different from the BOM
 * release hard-gate.
 */
export class QualificationWarningEntity {
  @ApiProperty() partnerType!: 'SUPPLIER' | 'VENDOR';
  @ApiProperty() partnerId!: string;
  @ApiProperty() partnerName!: string;
  @ApiProperty() status!: string;
  @ApiProperty() message!: string;

  constructor(p: Partial<QualificationWarningEntity>) {
    Object.assign(this, p);
  }
}

/**
 * The advance-payment leg of a PO, as the detail page needs to show it: what was
 * committed, and what Accounts has done about it.
 *
 * `status` is the AccountsPayablePayment's own status — the payment IS the
 * request, so there is no second workflow that could disagree with it about
 * whether the vendor has been paid. Null `paymentNumber` means the PO carries a
 * commitment but has not been issued yet, so no request exists.
 */
export class PurchaseOrderAdvanceEntity {
  @ApiProperty({ description: 'Percentage of the pre-tax line total' })
  percent!: string;
  @ApiProperty({
    nullable: true,
    description: 'Rupee value frozen at issue; null before issue',
  })
  amount!: string | null;
  @ApiProperty({
    nullable: true,
    description: 'Live derived value, for a DRAFT that has not been issued',
  })
  indicativeAmount!: string | null;
  @ApiProperty({ nullable: true }) paymentId!: string | null;
  @ApiProperty({ nullable: true }) paymentNumber!: string | null;
  @ApiProperty({
    enum: ApPaymentStatus,
    nullable: true,
    description: 'Null until the PO is issued and the request is raised',
  })
  status!: ApPaymentStatus | null;
  @ApiProperty({ nullable: true }) plannedDate!: string | null;
  @ApiProperty({ nullable: true }) executedDate!: string | null;
  @ApiProperty({ nullable: true }) bankReference!: string | null;
  @ApiProperty({ nullable: true }) rejectionComment!: string | null;

  constructor(p: Partial<PurchaseOrderAdvanceEntity>) {
    Object.assign(this, p);
  }
}

export class PurchaseOrderEntity {
  @ApiProperty() id!: string;
  @ApiProperty() poNumber!: string;
  @ApiProperty({ enum: PurchaseOrderStatus }) status!: PurchaseOrderStatus;

  @ApiProperty({ nullable: true }) supplierId!: string | null;
  @ApiProperty({ nullable: true }) supplierName!: string | null;
  @ApiProperty({ nullable: true }) vendorId!: string | null;
  @ApiProperty({ nullable: true }) vendorName!: string | null;
  @ApiProperty({ nullable: true }) adHocPartyName!: string | null;
  @ApiProperty({ nullable: true }) adHocContactInfo!: string | null;
  @ApiProperty({ nullable: true }) adHocPartyAddress!: string | null;
  @ApiProperty({ nullable: true }) ceoApprovedById!: string | null;
  @ApiProperty({ nullable: true }) ceoApprovedAt!: string | null;
  @ApiProperty({ nullable: true }) rejectedById!: string | null;
  @ApiProperty({ nullable: true }) rejectedAt!: string | null;
  @ApiProperty({ nullable: true }) rejectionComment!: string | null;

  @ApiProperty() orderDate!: string;
  @ApiProperty({ nullable: true }) expectedDeliveryDate!: string | null;
  @ApiProperty({ nullable: true }) notes!: string | null;

  @ApiProperty() createdById!: string;
  @ApiProperty({ nullable: true }) createdByName!: string | null;
  @ApiProperty({ nullable: true }) issuedAt!: string | null;
  @ApiProperty({ nullable: true }) cancelledAt!: string | null;

  /** When the order PDF was last emailed to the party, and to which address. */
  @ApiProperty({ nullable: true }) lastEmailedAt!: string | null;
  @ApiProperty({ nullable: true }) lastEmailedTo!: string | null;
  /**
   * The address a send would default to (the registered partner's contactEmail).
   * Null for an ad-hoc party, which has none — the UI then has to ask for one.
   */
  @ApiProperty({ nullable: true }) partyEmail!: string | null;

  @ApiProperty({ description: 'Sum of the line totals' })
  totalAmount!: string;

  @ApiProperty({ nullable: true, description: 'PO value frozen at submission' })
  approvalAmount!: string | null;

  /**
   * The advance commitment and where Accounts has taken it. Null when the PO
   * carries no advance.
   */
  @ApiProperty({ type: PurchaseOrderAdvanceEntity, nullable: true })
  advance!: PurchaseOrderAdvanceEntity | null;

  @ApiProperty({ isArray: true })
  approvals!: Array<{
    id: string;
    level: 'CSCO' | 'COO' | 'CEO';
    sequence: number;
    status: 'WAITING' | 'PENDING' | 'APPROVED' | 'REJECTED';
    decidedById: string | null;
    decidedByName: string | null;
    decidedAt: string | null;
    comment: string | null;
  }>;

  @ApiProperty({ type: [PurchaseOrderLineEntity] })
  lines!: PurchaseOrderLineEntity[];

  /**
   * Present on create/update responses when the chosen partner isn't qualified.
   * Non-blocking — the PO exists regardless.
   */
  @ApiProperty({ type: QualificationWarningEntity, nullable: true })
  qualificationWarning?: QualificationWarningEntity | null;

  @ApiProperty() createdAt!: string;
  @ApiProperty() updatedAt!: string;

  constructor(p: Partial<PurchaseOrderEntity>) {
    Object.assign(this, p);
  }
}
