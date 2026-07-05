import { ApiProperty } from '@nestjs/swagger';

/** Decrypted view — only ever returned to ADMIN/SUPER_ADMIN callers. */
export class EmployeeStatutoryEntity {
  @ApiProperty()
  employeeId!: string;

  @ApiProperty()
  panNumber!: string;

  @ApiProperty()
  aadhaarLast4!: string;

  @ApiProperty()
  pfAccountNumber!: string;

  @ApiProperty({ nullable: true })
  esicNumber!: string | null;

  constructor(partial: Partial<EmployeeStatutoryEntity>) {
    Object.assign(this, partial);
  }
}
