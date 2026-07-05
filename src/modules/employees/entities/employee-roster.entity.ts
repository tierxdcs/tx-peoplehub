import { ApiProperty } from '@nestjs/swagger';
import { AccessStatus, EmployeeStatus, EmploymentType } from '@prisma/client';

/**
 * Roster view for HR-vertical staff: core identity/employment fields only.
 * Deliberately excludes compensation/statutory/bank data even though HR
 * entered it — those are Admin-only reads (see employees.controller.ts).
 */
export class EmployeeRosterEntity {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  employeeId!: string;

  @ApiProperty()
  firstName!: string;

  @ApiProperty()
  lastName!: string;

  @ApiProperty({ nullable: true })
  designation!: string | null;

  @ApiProperty({ nullable: true })
  verticalId!: string | null;

  @ApiProperty({ enum: EmploymentType, nullable: true })
  employmentType!: EmploymentType | null;

  @ApiProperty({ nullable: true })
  dateOfJoining!: Date | null;

  @ApiProperty({ nullable: true })
  workLocation!: string | null;

  @ApiProperty({ nullable: true })
  mobile!: string | null;

  @ApiProperty({ enum: EmployeeStatus })
  status!: EmployeeStatus;

  @ApiProperty({ enum: AccessStatus })
  accessStatus!: AccessStatus;

  constructor(partial: Partial<EmployeeRosterEntity>) {
    Object.assign(this, partial);
  }
}

/**
 * Roster view for ADMIN/SUPER_ADMIN: adds completeness indicators for the
 * restricted tables (presence only — use the dedicated
 * /employees/:id/compensation|statutory|bank-details endpoints for values).
 */
export class EmployeeRosterAdminEntity extends EmployeeRosterEntity {
  @ApiProperty()
  hasCompensationOnFile!: boolean;

  @ApiProperty()
  hasStatutoryInfoOnFile!: boolean;

  @ApiProperty()
  hasBankDetailsOnFile!: boolean;

  constructor(partial: Partial<EmployeeRosterAdminEntity>) {
    super(partial);
    Object.assign(this, partial);
  }
}
