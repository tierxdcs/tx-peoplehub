import { ApiProperty } from '@nestjs/swagger';
import { LeaveAccrualType } from '@prisma/client';

export class LeaveTypeEntity {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  code!: string;

  @ApiProperty()
  name!: string;

  @ApiProperty({ enum: LeaveAccrualType })
  accrualType!: LeaveAccrualType;

  @ApiProperty({ nullable: true })
  annualQuota!: string | null;

  @ApiProperty({ nullable: true })
  carryForwardCap!: string | null;

  @ApiProperty()
  isActive!: boolean;

  constructor(partial: Partial<LeaveTypeEntity>) {
    Object.assign(this, partial);
  }
}
