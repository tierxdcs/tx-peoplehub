import { ApiProperty } from '@nestjs/swagger';

export class ProductEntity {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  sku!: string;

  @ApiProperty()
  name!: string;

  @ApiProperty({ nullable: true })
  description!: string | null;

  @ApiProperty({ description: 'Decimal serialized as string' })
  unitPrice!: string;

  @ApiProperty()
  unitOfMeasure!: string;

  @ApiProperty({ nullable: true })
  hsnCode!: string | null;

  @ApiProperty()
  isActive!: boolean;

  @ApiProperty({
    nullable: true,
    description:
      'Item Master item this product is manufactured as (keyed for BOM/stock).',
  })
  itemId!: string | null;

  @ApiProperty({
    nullable: true,
    description: 'Business unit this product belongs to.',
  })
  businessUnitId!: string | null;

  @ApiProperty({
    nullable: true,
    description: 'Business unit name (denormalized for list display).',
  })
  businessUnitName!: string | null;

  @ApiProperty({ nullable: true })
  businessUnitColorHex!: string | null;

  @ApiProperty({
    description:
      'True while the BU was auto-selected by inference and not yet confirmed.',
  })
  autoAssignedBusinessUnit!: boolean;

  @ApiProperty({ nullable: true, required: false })
  targetMarginPercent?: string | null;
  @ApiProperty({ nullable: true, required: false })
  rolledUpCostSnapshot?: string | null;
  @ApiProperty({ nullable: true, required: false })
  costSnapshotAt?: Date | null;
  @ApiProperty({ required: false })
  isCostComplete?: boolean;
  @ApiProperty({ nullable: true, required: false })
  suggestedUnitPrice?: string | null;
  @ApiProperty({ nullable: true, required: false })
  actualMarginPercent?: string | null;

  @ApiProperty()
  createdAt!: Date;

  @ApiProperty()
  updatedAt!: Date;

  constructor(partial: Partial<ProductEntity>) {
    Object.assign(this, partial);
  }
}
