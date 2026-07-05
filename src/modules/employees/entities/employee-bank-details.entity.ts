import { ApiProperty } from '@nestjs/swagger';

/** Decrypted view — only ever returned to ADMIN/SUPER_ADMIN callers. */
export class EmployeeBankDetailsEntity {
  @ApiProperty()
  employeeId!: string;

  @ApiProperty()
  bankAccountNumber!: string;

  @ApiProperty()
  ifscCode!: string;

  constructor(partial: Partial<EmployeeBankDetailsEntity>) {
    Object.assign(this, partial);
  }
}
