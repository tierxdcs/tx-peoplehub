import { ApiProperty } from '@nestjs/swagger';
import {
  AccessStatus,
  EmployeeStatus,
  Role,
  SignatureFont,
} from '@prisma/client';

/**
 * Public shape of an employee returned by the API. Never includes
 * passwordHash.
 */
export class EmployeeEntity {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  employeeId!: string;

  @ApiProperty()
  firstName!: string;

  @ApiProperty()
  lastName!: string;

  @ApiProperty()
  email!: string;

  @ApiProperty({ enum: Role, nullable: true })
  role!: Role | null;

  @ApiProperty({ nullable: true })
  verticalId!: string | null;

  @ApiProperty({ nullable: true })
  reportingManagerId!: string | null;

  @ApiProperty({ enum: EmployeeStatus })
  status!: EmployeeStatus;

  @ApiProperty({ nullable: true })
  deactivatedAt!: Date | null;

  @ApiProperty({ enum: AccessStatus })
  accessStatus!: AccessStatus;

  @ApiProperty({
    description: 'Whether this employee is the current Sales Head',
  })
  isSalesHead!: boolean;

  @ApiProperty({
    description: 'Whether this employee is a designated Scrum Master',
  })
  isScrumMaster!: boolean;

  @ApiProperty({
    description: 'Whether this employee is a designated Project Manager',
  })
  isProjectManager!: boolean;

  @ApiProperty({
    description: 'Whether this employee is a designated Internal Auditor',
  })
  isInternalAuditor!: boolean;

  @ApiProperty({
    description:
      'Whether this employee is a designated QC Inspector (incoming-goods QC gate authority)',
  })
  isQcInspector!: boolean;

  @ApiProperty({ description: 'Whether this employee is the sole designated QMS Head' })
  isQmsHead!: boolean;

  @ApiProperty({ description: 'Whether this employee is the sole designated Design Head' })
  isDesignHead!: boolean;

  @ApiProperty({
    description:
      'Whether this employee is a designated R&D Head (technical BOM approval authority)',
  })
  isRdHead!: boolean;

  @ApiProperty({
    description:
      'Whether this employee is the sole designated Finance/Accounts Head',
  })
  isAccountsHead!: boolean;

  @ApiProperty({ nullable: true })
  officialEmail!: string | null;

  @ApiProperty({ nullable: true, description: 'Internal e-signature text' })
  signatureText!: string | null;

  @ApiProperty({ enum: SignatureFont, nullable: true })
  signatureFont!: SignatureFont | null;

  @ApiProperty()
  createdAt!: Date;

  @ApiProperty()
  updatedAt!: Date;

  constructor(partial: Partial<EmployeeEntity>) {
    Object.assign(this, partial);
  }
}
