import { ApiProperty } from '@nestjs/swagger';
import {
  BomLineSource,
  BomStatus,
  ItemType,
  SignatureFont,
  StockBucket,
  SupplierStatus,
} from '@prisma/client';

// ── Item ─────────────────────────────────────────────────────────────
export class ItemEntity {
  @ApiProperty() id!: string;
  @ApiProperty() itemCode!: string;
  @ApiProperty() name!: string;
  @ApiProperty({ nullable: true }) description!: string | null;
  @ApiProperty({ enum: ItemType }) itemType!: ItemType;
  @ApiProperty() baseUnitOfMeasure!: string;
  @ApiProperty() isActive!: boolean;
  @ApiProperty({ nullable: true }) defaultWastagePercent!: string | null;
  @ApiProperty({ nullable: true }) drawingSpecReference!: string | null;
  @ApiProperty({ nullable: true }) standardLeadTimeDays!: number | null;
  @ApiProperty() createdAt!: string;
  @ApiProperty() updatedAt!: string;

  constructor(p: Partial<ItemEntity>) {
    Object.assign(this, p);
  }
}

// ── BOM ──────────────────────────────────────────────────────────────
export class BomLineEntity {
  @ApiProperty() id!: string;
  @ApiProperty() itemId!: string;
  @ApiProperty() itemCode!: string;
  @ApiProperty() itemName!: string;
  @ApiProperty() quantityPerUnit!: string;
  @ApiProperty() unitOfMeasure!: string;
  @ApiProperty() wastagePercent!: string;
  @ApiProperty({ enum: BomLineSource }) makeBuy!: BomLineSource;
  @ApiProperty({ nullable: true }) notes!: string | null;
  @ApiProperty({ nullable: true }) drawingSpecReference!: string | null;
  @ApiProperty() sequence!: number;

  constructor(p: Partial<BomLineEntity>) {
    Object.assign(this, p);
  }
}

export class BomEventEntity {
  @ApiProperty() id!: string;
  @ApiProperty() type!: string;
  @ApiProperty({ nullable: true }) actorId!: string | null;
  @ApiProperty({ nullable: true }) actorName!: string | null;
  @ApiProperty({ nullable: true }) comment!: string | null;
  @ApiProperty() createdAt!: string;

  constructor(p: Partial<BomEventEntity>) {
    Object.assign(this, p);
  }
}

export class BomEntity {
  @ApiProperty() id!: string;
  /** The Item Master item this BOM is FOR (not a Product — keyed on Item). */
  @ApiProperty() itemId!: string;
  @ApiProperty({ nullable: true }) itemCode!: string | null;
  @ApiProperty({ nullable: true }) itemName!: string | null;
  @ApiProperty({ enum: ['RAW_MATERIAL', 'COMPONENT', 'SUBASSEMBLY', 'FINISHED_GOOD', 'CONSUMABLE'], nullable: true })
  itemType!: ItemType | null;
  @ApiProperty() revisionNumber!: number;
  @ApiProperty({ enum: BomStatus }) status!: BomStatus;
  @ApiProperty({ nullable: true }) effectiveDate!: string | null;
  @ApiProperty({ nullable: true }) revisionNotes!: string | null;
  @ApiProperty() createdById!: string;
  @ApiProperty({ nullable: true }) createdByName!: string | null;
  @ApiProperty({ nullable: true }) submittedById!: string | null;
  @ApiProperty({ nullable: true }) submittedAt!: string | null;
  @ApiProperty({ nullable: true }) approvedById!: string | null;
  @ApiProperty({ nullable: true }) approvedByName!: string | null;
  @ApiProperty({ nullable: true }) approvedAt!: string | null;
  @ApiProperty({ nullable: true }) rejectedById!: string | null;
  @ApiProperty({ nullable: true }) rejectedAt!: string | null;
  @ApiProperty({ nullable: true }) rejectionComment!: string | null;
  @ApiProperty({ nullable: true }) approverSignatureTextSnapshot!: string | null;
  @ApiProperty({ enum: SignatureFont, nullable: true })
  approverSignatureFontSnapshot!: SignatureFont | null;
  @ApiProperty({ type: [BomLineEntity] }) lines!: BomLineEntity[];
  @ApiProperty({ type: [BomEventEntity], required: false })
  events?: BomEventEntity[];
  @ApiProperty() createdAt!: string;
  @ApiProperty() updatedAt!: string;

  constructor(p: Partial<BomEntity>) {
    Object.assign(this, p);
  }
}

// ── Inventory ────────────────────────────────────────────────────────
export class StoreLocationEntity {
  @ApiProperty() id!: string;
  @ApiProperty() code!: string;
  @ApiProperty() name!: string;
  @ApiProperty() isActive!: boolean;

  constructor(p: Partial<StoreLocationEntity>) {
    Object.assign(this, p);
  }
}

export class StockBalanceEntity {
  @ApiProperty() id!: string;
  @ApiProperty() itemId!: string;
  @ApiProperty() itemCode!: string;
  @ApiProperty() itemName!: string;
  @ApiProperty() baseUnitOfMeasure!: string;
  @ApiProperty() storeLocationId!: string;
  @ApiProperty() storeLocationName!: string;
  @ApiProperty() onHandQuantity!: string;
  @ApiProperty() reservedQuantity!: string;
  @ApiProperty() blockedQuantity!: string;
  @ApiProperty({ description: 'Derived: onHand - reserved - blocked' })
  availableQuantity!: string;
  @ApiProperty({ nullable: true }) expectedReceiptQuantity!: string | null;
  @ApiProperty({ nullable: true }) expectedReceiptDate!: string | null;
  @ApiProperty() updatedAt!: string;

  constructor(p: Partial<StockBalanceEntity>) {
    Object.assign(this, p);
  }
}

export class StockAdjustmentEntity {
  @ApiProperty() id!: string;
  @ApiProperty() itemId!: string;
  @ApiProperty() storeLocationId!: string;
  @ApiProperty({ enum: StockBucket }) bucket!: StockBucket;
  @ApiProperty() quantityChange!: string;
  @ApiProperty() reason!: string;
  @ApiProperty({ nullable: true }) actorId!: string | null;
  @ApiProperty({ nullable: true }) actorName!: string | null;
  @ApiProperty() createdAt!: string;

  constructor(p: Partial<StockAdjustmentEntity>) {
    Object.assign(this, p);
  }
}

export class ReservationEntity {
  @ApiProperty() id!: string;
  @ApiProperty() kickoffId!: string;
  @ApiProperty() itemId!: string;
  @ApiProperty() itemCode!: string;
  @ApiProperty() itemName!: string;
  @ApiProperty() storeLocationId!: string;
  @ApiProperty() storeLocationName!: string;
  @ApiProperty() quantity!: string;
  @ApiProperty() isActive!: boolean;
  @ApiProperty() createdById!: string;
  @ApiProperty() createdAt!: string;
  @ApiProperty({ nullable: true }) cancelledAt!: string | null;

  constructor(p: Partial<ReservationEntity>) {
    Object.assign(this, p);
  }
}

/** A link between an Item and a qualified Supplier (powers the release gate). */
export class ItemSupplierEntity {
  @ApiProperty() id!: string;
  @ApiProperty() itemId!: string;
  @ApiProperty() supplierId!: string;
  @ApiProperty() supplierName!: string;
  @ApiProperty({ enum: ['PENDING_QUESTIONNAIRE', 'QUESTIONNAIRE_SUBMITTED', 'UNDER_AUDIT', 'APPROVED_PREFERRED', 'APPROVED', 'CONDITIONALLY_APPROVED', 'NOT_APPROVED'] })
  supplierStatus!: SupplierStatus;
  @ApiProperty({ description: 'Whether this supplier link currently qualifies the item (APPROVED / APPROVED_PREFERRED)' })
  isQualified!: boolean;
  @ApiProperty({ nullable: true }) supplierPartNumber!: string | null;
  @ApiProperty() createdById!: string;
  @ApiProperty() createdAt!: string;

  constructor(p: Partial<ItemSupplierEntity>) {
    Object.assign(this, p);
  }
}
