import { ApiProperty } from '@nestjs/swagger';
import {
  GoodsReceiptNoteStatus,
  PackingCondition,
  QmsInspectionResult,
  QmsInspectionStatus,
  QmsResponseType,
} from '@prisma/client';
import { NonConformanceReportEntity } from './non-conformance-report.entity';

/** One answered question of a finalized line's incoming-inspection checklist. */
export class GrnInspectionResponseEntity {
  @ApiProperty() questionKey!: string;
  @ApiProperty() section!: string;
  @ApiProperty() sequence!: number;
  @ApiProperty() prompt!: string;
  @ApiProperty({ enum: QmsResponseType }) responseType!: QmsResponseType;
  @ApiProperty() required!: boolean;
  @ApiProperty({ nullable: true }) answer!: string | null;
  @ApiProperty({ enum: QmsInspectionResult, nullable: true })
  result!: QmsInspectionResult | null;
  @ApiProperty({ nullable: true }) comments!: string | null;

  constructor(p: Partial<GrnInspectionResponseEntity>) {
    Object.assign(this, p);
  }
}

/**
 * The QmsInspection recorded for a GRN line at the QC gate — the audit answer to
 * "on what basis was this accepted?". Null until the GRN is finalized (and on
 * lines finalized before incoming inspection became mandatory).
 */
export class GrnLineInspectionEntity {
  @ApiProperty() id!: string;
  @ApiProperty() inspectionNumber!: string;
  @ApiProperty({ enum: QmsInspectionStatus }) status!: QmsInspectionStatus;
  @ApiProperty({ enum: QmsInspectionResult, nullable: true })
  overallResult!: QmsInspectionResult | null;
  @ApiProperty({ nullable: true }) templateCode!: string | null;
  @ApiProperty({ nullable: true }) templateName!: string | null;
  @ApiProperty({ nullable: true }) templateVersion!: number | null;
  @ApiProperty({ nullable: true }) inspectedAt!: string | null;
  @ApiProperty({ nullable: true }) remarks!: string | null;

  @ApiProperty({ type: [GrnInspectionResponseEntity] })
  responses!: GrnInspectionResponseEntity[];

  constructor(p: Partial<GrnLineInspectionEntity>) {
    Object.assign(this, p);
  }
}

export class GoodsReceiptNoteLineEntity {
  @ApiProperty() id!: string;
  @ApiProperty() purchaseOrderLineId!: string;
  @ApiProperty() itemId!: string;
  @ApiProperty() itemCode!: string;
  @ApiProperty() itemName!: string;
  @ApiProperty() storeLocationId!: string;
  @ApiProperty({ nullable: true }) storeLocationName!: string | null;

  @ApiProperty({ description: 'Decimal serialized as string' })
  orderedQuantity!: string;
  @ApiProperty({ description: 'Decimal serialized as string' })
  receivedQuantity!: string;
  @ApiProperty({ nullable: true }) acceptedQuantity!: string | null;
  @ApiProperty({ nullable: true }) rejectedQuantity!: string | null;
  @ApiProperty({ nullable: true }) rejectionReason!: string | null;

  /**
   * Sum of ACCEPTED quantities on all EARLIER finalized GRN lines against the
   * same PO line. Computed on read, never stored.
   */
  @ApiProperty({ description: 'Cumulative accepted qty from prior GRNs' })
  previouslyReceived!: string;

  @ApiProperty() unitOfMeasure!: string;
  @ApiProperty() sequence!: number;

  /** The incoming inspection this line's decision was based on. */
  @ApiProperty({ type: GrnLineInspectionEntity, nullable: true })
  inspection!: GrnLineInspectionEntity | null;

  constructor(p: Partial<GoodsReceiptNoteLineEntity>) {
    Object.assign(this, p);
  }
}

/**
 * A non-blocking warning that cumulative accepted receipt against a PO line
 * would exceed the ordered quantity. Surfaced on QC finalize — never blocks.
 */
export class OverReceiptWarningEntity {
  @ApiProperty() purchaseOrderLineId!: string;
  @ApiProperty() itemCode!: string;
  @ApiProperty() orderedQuantity!: string;
  @ApiProperty() cumulativeAccepted!: string;
  @ApiProperty() message!: string;

  constructor(p: Partial<OverReceiptWarningEntity>) {
    Object.assign(this, p);
  }
}

export class GoodsReceiptNoteEntity {
  @ApiProperty() id!: string;
  @ApiProperty() grnNumber!: string;
  @ApiProperty({ enum: GoodsReceiptNoteStatus })
  status!: GoodsReceiptNoteStatus;

  @ApiProperty() purchaseOrderId!: string;
  @ApiProperty({ nullable: true }) poNumber!: string | null;

  @ApiProperty() receivedById!: string;
  @ApiProperty({ nullable: true }) receivedByName!: string | null;
  @ApiProperty() receivedDate!: string;

  @ApiProperty({ nullable: true }) inspectedById!: string | null;
  @ApiProperty({ nullable: true }) inspectedByName!: string | null;
  @ApiProperty({ nullable: true }) inspectedAt!: string | null;

  // Logistics / sign-off details (spec §3.1) — real, queryable columns.
  @ApiProperty({ nullable: true }) vendorDeliveryChallanNumber!: string | null;
  @ApiProperty({ nullable: true }) deliveryChallanDate!: string | null;
  @ApiProperty({ nullable: true }) vehicleOrAwbNumber!: string | null;
  @ApiProperty({ nullable: true }) driverOrCourier!: string | null;
  @ApiProperty({ nullable: true }) totalPackagesReceived!: number | null;
  @ApiProperty({ enum: PackingCondition, nullable: true })
  packingCondition!: PackingCondition | null;
  @ApiProperty({ nullable: true }) supervisorSignOffId!: string | null;
  @ApiProperty({ nullable: true }) supervisorSignOffName!: string | null;

  /** Free-text receiving remarks (no longer carries structured logistics data). */
  @ApiProperty({ nullable: true }) notes!: string | null;

  @ApiProperty({ type: [GoodsReceiptNoteLineEntity] })
  lines!: GoodsReceiptNoteLineEntity[];

  @ApiProperty({ type: [NonConformanceReportEntity] })
  ncrs!: NonConformanceReportEntity[];

  /** Present on QC finalize when cumulative accepted exceeds ordered. */
  @ApiProperty({ type: [OverReceiptWarningEntity] })
  overReceiptWarnings?: OverReceiptWarningEntity[];

  @ApiProperty() createdAt!: string;
  @ApiProperty() updatedAt!: string;

  constructor(p: Partial<GoodsReceiptNoteEntity>) {
    Object.assign(this, p);
  }
}
