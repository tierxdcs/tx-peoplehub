import { ApiProperty } from '@nestjs/swagger';
import {
  OrderFinalQcStatus,
  OrderFulfilmentStatus,
  OrderLineDeliveryType,
  OrderStatus,
  OrderType,
} from '@prisma/client';

export class OrderLineItemEntity {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  orderId!: string;

  @ApiProperty({ nullable: true })
  productId!: string | null;

  @ApiProperty({ nullable: true })
  adHocProductName!: string | null;

  @ApiProperty({ nullable: true })
  adHocDescription!: string | null;

  @ApiProperty({ description: 'Whether this line still awaits Product setup' })
  isAdHoc!: boolean;

  @ApiProperty({
    description:
      'Display name for order-context/customer surfaces: the customer-facing override when set, else the real Product name',
  })
  productName!: string;

  @ApiProperty({
    description:
      'The real Product name, regardless of any customer-facing override — for internal cross-reference',
  })
  internalProductName!: string;

  @ApiProperty({
    nullable: true,
    description: "Customer's own PO wording for this line (display override)",
  })
  customerFacingProductName!: string | null;

  @ApiProperty({ nullable: true })
  customerFacingDescription!: string | null;

  @ApiProperty({ description: 'Resolved product SKU (for display)' })
  productSku!: string;

  @ApiProperty({ description: 'Decimal serialized as string' })
  quantity!: string;

  @ApiProperty()
  unitPrice!: string;

  @ApiProperty()
  lineTotal!: string;

  @ApiProperty({
    enum: OrderLineDeliveryType,
    nullable: true,
    description: 'Per-line delivery classification, set at project kickoff',
  })
  deliveryType!: OrderLineDeliveryType | null;

  @ApiProperty({
    nullable: true,
    description: 'Free-text vendor placeholder (VENDOR only) — see schema note',
  })
  vendorName!: string | null;

  @ApiProperty({ nullable: true })
  vendorContactInfo!: string | null;

  @ApiProperty({ nullable: true })
  vendorExpectedLeadTime!: string | null;

  @ApiProperty({
    required: false,
    description:
      'Whether this line carries in-progress PLM/design work. Only populated on the single-order fetch; used by the bid-promotion reconciliation UI to lock such lines.',
  })
  hasPlmTracker?: boolean;

  constructor(partial: Partial<OrderLineItemEntity>) {
    Object.assign(this, partial);
  }
}

export class OrderEntity {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  orderNumber!: string;

  @ApiProperty({
    enum: OrderType,
    description: 'CUSTOMER (bid-converted) vs INTERNAL (sample/speculative)',
  })
  orderType!: OrderType;

  @ApiProperty({ nullable: true })
  bidId!: string | null;

  @ApiProperty({
    nullable: true,
    description: 'Null for an internal order with no prospective customer',
  })
  customerId!: string | null;

  @ApiProperty({
    nullable: true,
    description: 'Resolved customer name (for display)',
  })
  customerName!: string | null;

  @ApiProperty({ enum: OrderStatus })
  status!: OrderStatus;

  @ApiProperty({
    description:
      'Derived dispatch-picker eligibility: a PLM split is at Dispatch/Completed, or the legacy order workflow is Ready to Ship or beyond',
  })
  dispatchReady!: boolean;

  @ApiProperty({ enum: OrderFulfilmentStatus })
  fulfilmentStatus!: OrderFulfilmentStatus;

  @ApiProperty({
    enum: OrderFinalQcStatus,
    description: 'Outbound final-QC clearance used by the dispatch gate',
  })
  finalQcStatus!: OrderFinalQcStatus;

  @ApiProperty({ description: 'Booked value, snapshot of the bid total' })
  totalAmount!: string;

  @ApiProperty({ nullable: true })
  productionRunId!: string | null;

  @ApiProperty({ nullable: true })
  shipmentId!: string | null;

  @ApiProperty()
  ownerId!: string;

  @ApiProperty({ description: 'Current owner' })
  ownerName!: string;

  @ApiProperty({
    nullable: true,
    description: 'Immutable user credited with originating the enquiry',
  })
  enquiryCreatorId!: string | null;

  @ApiProperty({ nullable: true })
  enquiryCreatorName!: string | null;

  @ApiProperty({ nullable: true })
  businessUnitId!: string | null;

  @ApiProperty({ nullable: true })
  businessUnitName!: string | null;

  @ApiProperty({ nullable: true })
  businessUnitColorHex!: string | null;

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
