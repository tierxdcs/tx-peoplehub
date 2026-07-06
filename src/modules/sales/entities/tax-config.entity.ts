import { ApiProperty } from '@nestjs/swagger';
import { SalesTaxType } from '@prisma/client';

export class TaxConfigEntity {
  @ApiProperty()
  id!: string;

  @ApiProperty({ enum: SalesTaxType })
  taxType!: SalesTaxType;

  @ApiProperty({ description: 'Percentage, Decimal serialized as string' })
  rate!: string;

  @ApiProperty()
  effectiveFrom!: Date;

  @ApiProperty({ nullable: true })
  effectiveTo!: Date | null;

  @ApiProperty()
  sourceNote!: string;

  constructor(partial: Partial<TaxConfigEntity>) {
    Object.assign(this, partial);
  }
}
