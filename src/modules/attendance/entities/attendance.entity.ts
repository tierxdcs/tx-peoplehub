import { ApiProperty } from '@nestjs/swagger';

export type AttendanceStatus = 'PRESENT' | 'ABSENT' | 'ON_LEAVE' | 'HALF_DAY';

/**
 * `status` is never a DB column — it's derived on read from
 * checkInTime/checkOutTime plus approved-leave lookups, so there is one
 * source of truth for how it's computed (Admin corrections set times
 * directly, never status). See AttendanceService.deriveStatus.
 */
export class AttendanceEntity {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  employeeId!: string;

  @ApiProperty()
  date!: Date;

  @ApiProperty({ nullable: true })
  checkInTime!: Date | null;

  @ApiProperty({ nullable: true })
  checkOutTime!: Date | null;

  @ApiProperty({
    enum: ['PRESENT', 'ABSENT', 'ON_LEAVE', 'HALF_DAY'],
  })
  status!: AttendanceStatus;

  constructor(partial: Partial<AttendanceEntity>) {
    Object.assign(this, partial);
  }
}
