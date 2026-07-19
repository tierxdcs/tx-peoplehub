import { ApiProperty } from '@nestjs/swagger';
import { DeliveryChallanStatus, TransportMode } from '@prisma/client';

export class DeliveryChallanLineEntity {
  @ApiProperty() id!: string;
  @ApiProperty() orderLineId!: string;
  @ApiProperty() itemId!: string;
  @ApiProperty({ nullable: true }) itemCode!: string | null;
  @ApiProperty() description!: string;
  @ApiProperty({ nullable: true }) hsnCode!: string | null;
  @ApiProperty({ description: 'Quantity dispatched in this DC' })
  quantity!: string;
  @ApiProperty() unitOfMeasure!: string;
  @ApiProperty() unitRate!: string;
  @ApiProperty() lineValue!: string;
  /** Ordered quantity on the linked order line (context for the register). */
  @ApiProperty() orderedQuantity!: string;
  /** Sum of dispatched qty from OTHER non-cancelled DCs against this order line. */
  @ApiProperty() previouslyDispatched!: string;
  @ApiProperty() sequence!: number;

  constructor(p: Partial<DeliveryChallanLineEntity>) {
    Object.assign(this, p);
  }
}

/** Non-blocking warning that a line would push cumulative dispatched > ordered. */
export class OverDispatchWarningEntity {
  @ApiProperty() orderLineId!: string;
  @ApiProperty() description!: string;
  @ApiProperty() orderedQuantity!: string;
  @ApiProperty() cumulativeDispatched!: string;
  @ApiProperty() message!: string;

  constructor(p: Partial<OverDispatchWarningEntity>) {
    Object.assign(this, p);
  }
}

export class DeliveryChallanEntity {
  @ApiProperty() id!: string;
  @ApiProperty() dcNumber!: string;
  @ApiProperty({ enum: DeliveryChallanStatus }) status!: DeliveryChallanStatus;

  @ApiProperty() orderId!: string;
  @ApiProperty({ nullable: true }) orderNumber!: string | null;
  @ApiProperty() customerId!: string;
  @ApiProperty({ nullable: true }) customerName!: string | null;
  @ApiProperty({ nullable: true }) customerPoReference!: string | null;
  @ApiProperty() dispatchDate!: string;

  @ApiProperty() consigneeName!: string;
  @ApiProperty() consigneeAddress!: string;
  @ApiProperty({ nullable: true }) consigneeGstin!: string | null;
  @ApiProperty() consigneeStateCode!: string;

  @ApiProperty({ enum: TransportMode }) transportMode!: TransportMode;
  @ApiProperty({ nullable: true }) transporterName!: string | null;
  @ApiProperty({ nullable: true }) vehicleOrAwbNumber!: string | null;
  @ApiProperty({ nullable: true }) driverName!: string | null;
  @ApiProperty({ nullable: true }) driverPhone!: string | null;
  @ApiProperty({ nullable: true }) specialDeliveryInstructions!: string | null;
  @ApiProperty({ nullable: true }) documentsIncluded!: Record<string, boolean> | null;

  @ApiProperty({ nullable: true }) promisedDeliveryDate!: string | null;
  @ApiProperty({ nullable: true }) actualDeliveryDate!: string | null;

  @ApiProperty({ nullable: true }) linkedInvoiceId!: string | null;
  @ApiProperty({ nullable: true }) linkedInvoiceNumber!: string | null;
  @ApiProperty({ nullable: true }) linkedInvoiceStatus!: string | null;

  @ApiProperty({ nullable: true }) eWayBillNumber!: string | null;
  @ApiProperty({ nullable: true }) eWayBillDate!: string | null;
  @ApiProperty({ nullable: true }) eWayBillValidUntil!: string | null;

  @ApiProperty({ nullable: true }) podFileKey!: string | null;
  @ApiProperty({ nullable: true }) podReceivedBy!: string | null;
  @ApiProperty({ nullable: true }) podNotes!: string | null;

  @ApiProperty() createdById!: string;
  @ApiProperty({ nullable: true }) createdByName!: string | null;

  @ApiProperty({ type: [DeliveryChallanLineEntity] })
  lines!: DeliveryChallanLineEntity[];

  /** Present on create/update/dispatch when a line exceeds remaining ordered qty. */
  @ApiProperty({ type: [OverDispatchWarningEntity] })
  overDispatchWarnings?: OverDispatchWarningEntity[];

  @ApiProperty() createdAt!: string;
  @ApiProperty() updatedAt!: string;

  constructor(p: Partial<DeliveryChallanEntity>) {
    Object.assign(this, p);
  }
}
