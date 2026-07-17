import { ApiProperty } from '@nestjs/swagger';

export type AvailabilityStatus =
  | 'AVAILABLE'
  | 'EXPECTED_BEFORE_REQUIRED_DATE'
  | 'SHORTAGE'
  | 'UNKNOWN';

/** One aggregated required item row in the stock-availability report. */
export class StockAvailabilityRowEntity {
  @ApiProperty({ nullable: true }) itemId!: string | null;
  @ApiProperty() itemCode!: string;
  @ApiProperty() itemName!: string;
  @ApiProperty() unitOfMeasure!: string;
  @ApiProperty({
    description: 'Which BOM revisions contributed to this requirement',
    type: [String],
  })
  bomRevisionSources!: string[];
  @ApiProperty() orderedProductQuantity!: string;
  @ApiProperty() baseRequirement!: string;
  @ApiProperty() wastagePercent!: string;
  @ApiProperty() wastageQuantity!: string;
  @ApiProperty() grossRequirement!: string;
  @ApiProperty() onHandQuantity!: string;
  @ApiProperty() reservedQuantity!: string;
  @ApiProperty() blockedQuantity!: string;
  @ApiProperty() availableQuantity!: string;
  @ApiProperty({
    description:
      'Reserved by THIS kickoff (already earmarked; not a competing demand)',
  })
  reservedForThisKickoff!: string;
  @ApiProperty({ nullable: true }) expectedReceiptQuantity!: string | null;
  @ApiProperty({ nullable: true }) expectedReceiptDate!: string | null;
  @ApiProperty({ description: 'gross - (available + reservedForThisKickoff), if positive' })
  shortageQuantity!: string;
  @ApiProperty({ description: 'surplus if effective available exceeds gross' })
  surplusQuantity!: string;
  @ApiProperty() reservedRequiredQuantity!: string;
  @ApiProperty() unreservedRequiredQuantity!: string;
  @ApiProperty({
    enum: ['AVAILABLE', 'EXPECTED_BEFORE_REQUIRED_DATE', 'SHORTAGE', 'UNKNOWN'],
  })
  availabilityStatus!: AvailabilityStatus;

  constructor(p: Partial<StockAvailabilityRowEntity>) {
    Object.assign(this, p);
  }
}

export class StockAvailabilitySummaryEntity {
  @ApiProperty() available!: number;
  @ApiProperty() expected!: number;
  @ApiProperty() shortage!: number;
  @ApiProperty() unknown!: number;
  @ApiProperty() totalItems!: number;

  constructor(p: Partial<StockAvailabilitySummaryEntity>) {
    Object.assign(this, p);
  }
}

export class BomSelectionEntity {
  @ApiProperty() orderLineItemId!: string;
  @ApiProperty() productId!: string;
  @ApiProperty() productName!: string;
  @ApiProperty() productSku!: string;
  @ApiProperty() orderedQuantity!: string;
  @ApiProperty() bomId!: string;
  @ApiProperty() bomRevisionNumber!: number;

  constructor(p: Partial<BomSelectionEntity>) {
    Object.assign(this, p);
  }
}

export class StockAvailabilityReportEntity {
  @ApiProperty() kickoffId!: string;
  @ApiProperty() generatedAt!: string;
  @ApiProperty() quantityPrecision!: number;
  @ApiProperty({ type: [BomSelectionEntity] })
  bomSelections!: BomSelectionEntity[];
  @ApiProperty({ type: [StockAvailabilityRowEntity] })
  rows!: StockAvailabilityRowEntity[];
  @ApiProperty({ type: StockAvailabilitySummaryEntity })
  summary!: StockAvailabilitySummaryEntity;

  constructor(p: Partial<StockAvailabilityReportEntity>) {
    Object.assign(this, p);
  }
}
