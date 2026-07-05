import { ApiProperty } from '@nestjs/swagger';
import { EmployeeStatus, Role } from '@prisma/client';

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

  @ApiProperty({ enum: Role })
  role!: Role;

  @ApiProperty({ nullable: true })
  verticalId!: string | null;

  @ApiProperty({ nullable: true })
  reportingManagerId!: string | null;

  @ApiProperty({ enum: EmployeeStatus })
  status!: EmployeeStatus;

  @ApiProperty({ nullable: true })
  deactivatedAt!: Date | null;

  @ApiProperty()
  createdAt!: Date;

  @ApiProperty()
  updatedAt!: Date;

  constructor(partial: Partial<EmployeeEntity>) {
    Object.assign(this, partial);
  }
}
