import { ApiProperty } from '@nestjs/swagger';
import { OrderStatus } from '@prisma/client';

export class OrderLineItemEntity {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  orderId!: string;

  @ApiProperty()
  productId!: string;

  @ApiProperty({ description: 'Resolved product name (for display)' })
  productName!: string;

  @ApiProperty({ description: 'Resolved product SKU (for display)' })
  productSku!: string;

  @ApiProperty({ description: 'Decimal serialized as string' })
  quantity!: string;

  @ApiProperty()
  unitPrice!: string;

  @ApiProperty()
  lineTotal!: string;

  constructor(partial: Partial<OrderLineItemEntity>) {
    Object.assign(this, partial);
  }
}

export class OrderEntity {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  orderNumber!: string;

  @ApiProperty({ nullable: true })
  bidId!: string | null;

  @ApiProperty()
  customerId!: string;

  @ApiProperty({ enum: OrderStatus })
  status!: OrderStatus;

  @ApiProperty({ description: 'Booked value, snapshot of the bid total' })
  totalAmount!: string;

  @ApiProperty({ nullable: true })
  productionRunId!: string | null;

  @ApiProperty({ nullable: true })
  shipmentId!: string | null;

  @ApiProperty()
  ownerId!: string;

  @ApiProperty({ type: [OrderLineItemEntity], required: false })
  lineItems?: OrderLineItemEntity[];

  @ApiProperty()
  createdAt!: Date;

  @ApiProperty()
  updatedAt!: Date;

  constructor(partial: Partial<OrderEntity>) {
    Object.assign(this, partial);
  }
}
