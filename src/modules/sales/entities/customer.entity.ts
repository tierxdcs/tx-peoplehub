import { ApiProperty } from '@nestjs/swagger';
import { CustomerStatus } from '@prisma/client';

export class CustomerContactEntity {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  customerId!: string;

  @ApiProperty()
  name!: string;

  @ApiProperty({ nullable: true })
  email!: string | null;

  @ApiProperty({ nullable: true })
  phone!: string | null;

  @ApiProperty({ nullable: true })
  designation!: string | null;

  @ApiProperty()
  isPrimary!: boolean;

  constructor(partial: Partial<CustomerContactEntity>) {
    Object.assign(this, partial);
  }
}

export class CustomerEntity {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  name!: string;

  @ApiProperty({ nullable: true })
  gstin!: string | null;

  @ApiProperty()
  billingAddress!: Record<string, unknown> | string;

  @ApiProperty({ nullable: true })
  shippingAddress!: Record<string, unknown> | string | null;

  @ApiProperty({ nullable: true })
  industry!: string | null;

  @ApiProperty()
  ownerId!: string;

  @ApiProperty({ enum: CustomerStatus })
  status!: CustomerStatus;

  @ApiProperty({ type: [CustomerContactEntity], required: false })
  contacts?: CustomerContactEntity[];

  @ApiProperty()
  createdAt!: Date;

  @ApiProperty()
  updatedAt!: Date;

  constructor(partial: Partial<CustomerEntity>) {
    Object.assign(this, partial);
  }
}
