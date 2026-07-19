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

  @ApiProperty()
  createdAt!: Date;

  @ApiProperty()
  updatedAt!: Date;

  constructor(partial: Partial<ProductEntity>) {
    Object.assign(this, partial);
  }
}
