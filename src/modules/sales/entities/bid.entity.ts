import { ApiProperty } from '@nestjs/swagger';
import { BidStatus, SalesTaxType, SignatureFont } from '@prisma/client';

export class BidLineItemEntity {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  bidId!: string;

  @ApiProperty()
  productId!: string;

  @ApiProperty({ description: 'Resolved product name (for display)' })
  productName!: string;

  @ApiProperty({ description: 'Resolved product SKU (for display)' })
  productSku!: string;

  @ApiProperty({
    nullable: true,
    description: 'Resolved product description/specification (for display)',
  })
  productDescription!: string | null;

  @ApiProperty({
    description: 'Resolved product unit of measure (for display)',
  })
  productUnitOfMeasure!: string;

  @ApiProperty({ description: 'Decimal serialized as string' })
  quantity!: string;

  @ApiProperty({ description: 'Snapshot unit price at bid creation' })
  unitPrice!: string;

  @ApiProperty({ nullable: true })
  lineDiscountPercent!: string | null;

  @ApiProperty()
  lineTotal!: string;

  constructor(partial: Partial<BidLineItemEntity>) {
    Object.assign(this, partial);
  }
}

export class BidAmcChargeEntity {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  bidId!: string;

  @ApiProperty({ enum: [2, 3, 4, 5] })
  yearNumber!: number;

  @ApiProperty({ description: 'Flat untaxed amount serialized as string' })
  amount!: string;

  constructor(partial: Partial<BidAmcChargeEntity>) {
    Object.assign(this, partial);
  }
}

export class BidEntity {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  bidNumber!: string;

  @ApiProperty()
  opportunityId!: string;

  @ApiProperty()
  customerId!: string;

  @ApiProperty({ enum: BidStatus })
  status!: BidStatus;

  @ApiProperty()
  validUntil!: Date;

  @ApiProperty({ nullable: true })
  tenderReferenceNumber!: string | null;

  @ApiProperty({
    nullable: true,
    description:
      'One-line quotation subject (Subject line + opening paragraph)',
  })
  quotationSubject!: string | null;

  @ApiProperty({
    nullable: true,
    description: 'Internal technical notes — not rendered in the proposal PDF',
  })
  technicalSpecification!: string | null;

  @ApiProperty({
    nullable: true,
    description: 'Metadata only — [{filename, url}]',
  })
  attachments!: unknown;

  @ApiProperty()
  subtotal!: string;

  @ApiProperty()
  discountPercent!: string;

  @ApiProperty()
  discountAmount!: string;

  @ApiProperty({ enum: SalesTaxType, nullable: true })
  taxType!: SalesTaxType | null;

  @ApiProperty({ nullable: true })
  taxRate!: string | null;

  @ApiProperty()
  taxAmount!: string;

  @ApiProperty()
  totalAmount!: string;

  @ApiProperty({
    description: 'Computed sum of optional AMC charges; not stored on Bid',
  })
  amcTotal!: string;

  @ApiProperty({
    description: 'Computed totalAmount + amcTotal; not stored on Bid',
  })
  grandTotal!: string;

  @ApiProperty()
  createdById!: string;

  @ApiProperty({
    description: 'Immutable user credited with originating the enquiry',
  })
  enquiryCreatorId!: string;

  @ApiProperty()
  enquiryCreatorName!: string;

  @ApiProperty({ description: 'Current owner (via the opportunity)' })
  ownerName!: string;

  @ApiProperty()
  businessUnitId!: string;

  @ApiProperty()
  businessUnitName!: string;

  @ApiProperty()
  businessUnitColorHex!: string;

  @ApiProperty({ nullable: true })
  approverId!: string | null;

  @ApiProperty({ nullable: true })
  approvedAt!: Date | null;

  @ApiProperty({ nullable: true })
  approverComments!: string | null;

  @ApiProperty({
    nullable: true,
    description: "Approver's e-signature text, snapshotted at approval",
  })
  approverSignatureTextSnapshot!: string | null;

  @ApiProperty({ enum: SignatureFont, nullable: true })
  approverSignatureFontSnapshot!: SignatureFont | null;

  @ApiProperty({ type: [BidLineItemEntity], required: false })
  lineItems?: BidLineItemEntity[];

  @ApiProperty({ type: [BidAmcChargeEntity], required: false })
  amcCharges?: BidAmcChargeEntity[];

  @ApiProperty({
    nullable: true,
    description:
      'Id of the order this bid was converted into, if any. Non-null means it has already been converted (a bid converts to at most one order).',
  })
  convertedOrderId!: string | null;

  @ApiProperty()
  createdAt!: Date;

  @ApiProperty()
  updatedAt!: Date;

  constructor(partial: Partial<BidEntity>) {
    Object.assign(this, partial);
  }
}
