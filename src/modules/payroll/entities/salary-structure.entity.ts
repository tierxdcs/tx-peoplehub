import { ApiProperty } from '@nestjs/swagger';

/**
 * Public shape of a SalaryStructure row. Decimal fields are converted to
 * strings for JSON safety, matching the convention used elsewhere in this
 * codebase (see EmployeeCompensationEntity, the table this replaces).
 */
export class SalaryStructureEntity {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  employeeId!: string;

  @ApiProperty()
  effectiveFrom!: Date;

  @ApiProperty()
  basic!: string;

  @ApiProperty()
  hra!: string;

  @ApiProperty()
  specialAllowance!: string;

  @ApiProperty({ nullable: true })
  otherAllowances!: string | null;

  @ApiProperty()
  ctcAnnual!: string;

  constructor(partial: Partial<SalaryStructureEntity>) {
    Object.assign(this, partial);
  }
}
