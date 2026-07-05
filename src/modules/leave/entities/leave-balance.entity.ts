import { ApiProperty } from '@nestjs/swagger';

/**
 * `remaining` is computed here (allocated + carriedForward - used), never
 * stored — same rationale as the schema's own comment on LeaveBalance.
 */
export class LeaveBalanceEntity {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  leaveTypeId!: string;

  @ApiProperty()
  leaveTypeCode!: string;

  @ApiProperty()
  leaveTypeName!: string;

  @ApiProperty()
  year!: number;

  @ApiProperty()
  allocated!: string;

  @ApiProperty()
  used!: string;

  @ApiProperty()
  carriedForward!: string;

  @ApiProperty()
  remaining!: string;

  constructor(partial: Partial<LeaveBalanceEntity>) {
    Object.assign(this, partial);
  }
}
