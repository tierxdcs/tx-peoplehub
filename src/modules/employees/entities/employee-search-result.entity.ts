import { ApiProperty } from '@nestjs/swagger';

/**
 * Minimal employee shape for a type-ahead picker (share dialogs). Deliberately
 * lean — id + display fields only, no roles/status/sensitive columns — so the
 * search endpoint stays open to every authenticated employee without leaking
 * anything the roster (HR/Admin-only) protects.
 */
export class EmployeeSearchResultEntity {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  employeeId!: string;

  @ApiProperty()
  firstName!: string;

  @ApiProperty()
  lastName!: string;

  @ApiProperty({ description: 'Full display name (firstName + lastName)' })
  fullName!: string;

  @ApiProperty()
  email!: string;

  @ApiProperty({ nullable: true })
  verticalId!: string | null;

  constructor(partial: Partial<EmployeeSearchResultEntity>) {
    Object.assign(this, partial);
  }
}
