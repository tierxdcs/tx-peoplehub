import { ApiProperty } from '@nestjs/swagger';

/**
 * One resource-plan line. Per-unit values (benchmarkCostPerUnit,
 * negotiatedPricePerUnit) and requiredQuantity are STORED; the *Total and
 * variance figures are COMPUTED on read from those stored values — never
 * separately persisted, so they can never drift from the numbers they summarise
 * (§1). All money/quantity values are strings (Decimal, never Float).
 *
 * Variance sign convention (matches the system-wide cost delta): a POSITIVE
 * variance means negotiated > benchmark (a cost INCREASE, shown destructive); a
 * NEGATIVE variance means a SAVING (shown as success). variance* is null while
 * no negotiated price has been entered (nothing to compare yet).
 */
export class ResourcePlanLineEntity {
  @ApiProperty() id!: string;
  @ApiProperty() itemId!: string;
  @ApiProperty() itemCode!: string;
  @ApiProperty() itemName!: string;
  @ApiProperty() requiredQuantity!: string;
  @ApiProperty() unitOfMeasure!: string;
  @ApiProperty() benchmarkCostPerUnit!: string;
  @ApiProperty({ nullable: true }) negotiatedPricePerUnit!: string | null;
  @ApiProperty({ nullable: true }) notes!: string | null;

  @ApiProperty({ description: 'benchmarkCostPerUnit × requiredQuantity' })
  benchmarkLineTotal!: string;
  @ApiProperty({
    nullable: true,
    description: 'negotiatedPricePerUnit × requiredQuantity (null if unpriced)',
  })
  negotiatedLineTotal!: string | null;
  @ApiProperty({
    nullable: true,
    description:
      'negotiatedLineTotal − benchmarkLineTotal (+ = cost increase, − = saving); null if unpriced',
  })
  varianceAmount!: string | null;
  @ApiProperty({
    nullable: true,
    description: 'varianceAmount as a % of benchmarkLineTotal; null if unpriced',
  })
  variancePercent!: string | null;

  constructor(p: Partial<ResourcePlanLineEntity>) {
    Object.assign(this, p);
  }
}

/** Plan-level totals — computed by summing the lines on read. */
export class ResourcePlanSummaryEntity {
  @ApiProperty() totalBenchmarkCost!: string;
  @ApiProperty({
    nullable: true,
    description:
      'Sum of negotiated line totals. Lines with no negotiated price fall back to their benchmark total so the comparison stays whole-project.',
  })
  totalNegotiatedCost!: string;
  @ApiProperty({
    description: 'totalNegotiatedCost − totalBenchmarkCost (+ increase, − saving)',
  })
  varianceAmount!: string;
  @ApiProperty({ nullable: true }) variancePercent!: string | null;
  @ApiProperty() lineCount!: number;
  @ApiProperty({ description: 'How many lines have a negotiated price entered' })
  negotiatedLineCount!: number;

  constructor(p: Partial<ResourcePlanSummaryEntity>) {
    Object.assign(this, p);
  }
}

export class ResourcePlanEntity {
  @ApiProperty() id!: string;
  @ApiProperty() projectKickoffId!: string;
  @ApiProperty() projectName!: string;
  @ApiProperty() orderId!: string;
  @ApiProperty() orderNumber!: string;
  @ApiProperty() generatedAt!: string;
  @ApiProperty() generatedById!: string;
  @ApiProperty({ nullable: true }) generatedByName!: string | null;
  @ApiProperty({ type: [ResourcePlanLineEntity] })
  lines!: ResourcePlanLineEntity[];
  @ApiProperty({ type: ResourcePlanSummaryEntity })
  summary!: ResourcePlanSummaryEntity;

  constructor(p: Partial<ResourcePlanEntity>) {
    Object.assign(this, p);
  }
}

/**
 * One row of the project list (§3): every COMPLETED kickoff, flagged with
 * whether a plan exists and — if so — a compact variance summary.
 */
export class EligibleProjectEntity {
  @ApiProperty() projectKickoffId!: string;
  @ApiProperty() projectName!: string;
  @ApiProperty() orderId!: string;
  @ApiProperty() orderNumber!: string;
  @ApiProperty() customerName!: string;
  @ApiProperty() hasPlan!: boolean;
  @ApiProperty({ nullable: true }) planId!: string | null;
  @ApiProperty({ nullable: true }) generatedAt!: string | null;
  @ApiProperty({ nullable: true }) totalBenchmarkCost!: string | null;
  @ApiProperty({ nullable: true }) totalNegotiatedCost!: string | null;
  @ApiProperty({ nullable: true }) varianceAmount!: string | null;
  @ApiProperty({ nullable: true }) variancePercent!: string | null;

  constructor(p: Partial<EligibleProjectEntity>) {
    Object.assign(this, p);
  }
}

/**
 * One row of the cross-project summary (§5): every project that HAS a plan, with
 * its totals + variance %. Sortable client-side.
 */
export class CrossProjectSummaryRowEntity {
  @ApiProperty() planId!: string;
  @ApiProperty() projectKickoffId!: string;
  @ApiProperty() projectName!: string;
  @ApiProperty() orderNumber!: string;
  @ApiProperty() customerName!: string;
  @ApiProperty() generatedAt!: string;
  @ApiProperty() totalBenchmarkCost!: string;
  @ApiProperty() totalNegotiatedCost!: string;
  @ApiProperty() varianceAmount!: string;
  @ApiProperty({ nullable: true }) variancePercent!: string | null;
  @ApiProperty() lineCount!: number;
  @ApiProperty() negotiatedLineCount!: number;

  constructor(p: Partial<CrossProjectSummaryRowEntity>) {
    Object.assign(this, p);
  }
}
