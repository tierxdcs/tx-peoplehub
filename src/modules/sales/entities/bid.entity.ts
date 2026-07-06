import { ApiProperty } from '@nestjs/swagger';
import { BidStatus, SalesTaxType } from '@prisma/client';

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

  @ApiProperty({ nullable: true })
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

  @ApiProperty()
  createdById!: string;

  @ApiProperty({ nullable: true })
  approverId!: string | null;

  @ApiProperty({ nullable: true })
  approvedAt!: Date | null;

  @ApiProperty({ nullable: true })
  approverComments!: string | null;

  @ApiProperty({ type: [BidLineItemEntity], required: false })
  lineItems?: BidLineItemEntity[];

  @ApiProperty()
  createdAt!: Date;

  @ApiProperty()
  updatedAt!: Date;

  constructor(partial: Partial<BidEntity>) {
    Object.assign(this, partial);
  }
}
