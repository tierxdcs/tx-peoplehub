import { ApiProperty } from '@nestjs/swagger';

export class EmployeeCompensationEntity {
  @ApiProperty()
  employeeId!: string;

  @ApiProperty()
  basicSalary!: string;

  @ApiProperty()
  hra!: string;

  @ApiProperty()
  effectiveDate!: Date;

  constructor(partial: Partial<EmployeeCompensationEntity>) {
    Object.assign(this, partial);
  }
}
