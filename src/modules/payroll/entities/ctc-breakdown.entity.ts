import { ApiProperty } from '@nestjs/swagger';

/**
 * One line of the CTC breakdown. Amounts are Decimal-as-string (2 dp) for
 * JSON safety, matching the rest of the payroll entities. `perMonth`/
 * `perAnnum` are null when the value can't be computed (e.g. a missing
 * StatutoryConfig, or a row like TDS that is intentionally not computed —
 * see `note`). `emphasize` marks sub-total / total rows for the UI.
 */
export class CtcBreakdownRow {
  @ApiProperty()
  label!: string;

  @ApiProperty({ nullable: true })
  perMonth!: string | null;

  @ApiProperty({ nullable: true })
  perAnnum!: string | null;

  @ApiProperty({ required: false })
  emphasize?: boolean;

  @ApiProperty({
    required: false,
    description:
      'Free-text stand-in shown instead of an amount (e.g. TDS "As per Income Tax Act")',
  })
  note?: string;
}

/**
 * A fully-DERIVED CTC breakdown (the "offer letter" view): the earning
 * components come from the employee's current SalaryStructure, and every
 * statutory row (PF/ESI/PT and the employer contributions) is computed from
 * the effective StatutoryConfig via the SAME logic the payroll engine uses —
 * so this view can never drift from what actual payroll will produce.
 *
 * Nothing here is stored; it is recomputed on read. TDS is deliberately NOT
 * computed (the document shows it as "As per Income Tax Act" and Net Take
 * Home as "before TDS") — the annualised-projection TDS engine is not
 * trustworthy for an offer letter, so it is surfaced as a note only.
 */
export class CtcBreakdownEntity {
  @ApiProperty()
  employeeId!: string;

  @ApiProperty()
  effectiveFrom!: Date;

  @ApiProperty({ type: [CtcBreakdownRow] })
  directComponents!: CtcBreakdownRow[];

  @ApiProperty({ type: [CtcBreakdownRow] })
  employeeDeductions!: CtcBreakdownRow[];

  @ApiProperty({ type: [CtcBreakdownRow] })
  indirectBenefits!: CtcBreakdownRow[];

  @ApiProperty({ type: CtcBreakdownRow })
  grandTotal!: CtcBreakdownRow;

  @ApiProperty({
    type: [String],
    description:
      'Names of any StatutoryConfig rows missing for this employee — rows depending on them show "—" and CTC excludes them until configured',
  })
  warnings!: string[];

  constructor(partial: Partial<CtcBreakdownEntity>) {
    Object.assign(this, partial);
  }
}
