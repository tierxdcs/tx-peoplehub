import { ApiProperty } from '@nestjs/swagger';
import { PurchaseOrderStatus } from '@prisma/client';

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
