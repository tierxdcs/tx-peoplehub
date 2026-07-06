import { ApiProperty } from '@nestjs/swagger';
import { AccessStatus, EmployeeStatus, Role } from '@prisma/client';

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

  @ApiProperty({ nullable: true })
  officialEmail!: string | null;

  @ApiProperty()
  createdAt!: Date;

  @ApiProperty()
  updatedAt!: Date;

  constructor(partial: Partial<EmployeeEntity>) {
    Object.assign(this, partial);
  }
}
