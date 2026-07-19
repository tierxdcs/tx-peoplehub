import { ApiProperty } from '@nestjs/swagger';
import { PurchaseOrderStatus } from '@prisma/client';

export class PurchaseOrderLineEntity {
  @ApiProperty() id!: string;
  @ApiProperty() itemId!: string;
  @ApiProperty() itemCode!: string;
  @ApiProperty() itemName!: string;
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

  @ApiProperty() orderDate!: string;
  @ApiProperty({ nullable: true }) expectedDeliveryDate!: string | null;
  @ApiProperty({ nullable: true }) notes!: string | null;

  @ApiProperty() createdById!: string;
  @ApiProperty({ nullable: true }) createdByName!: string | null;
  @ApiProperty({ nullable: true }) issuedAt!: string | null;
  @ApiProperty({ nullable: true }) cancelledAt!: string | null;

  @ApiProperty({ description: 'Sum of the line totals' })
  totalAmount!: string;

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
