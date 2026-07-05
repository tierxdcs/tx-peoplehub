import { ApiProperty } from '@nestjs/swagger';
import { LeaveRequestStatus } from '@prisma/client';

export class LeaveRequestEntity {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  employeeId!: string;

  @ApiProperty()
  leaveTypeId!: string;

  @ApiProperty()
  startDate!: Date;

  @ApiProperty()
  endDate!: Date;

  @ApiProperty()
  numberOfDays!: string;

  @ApiProperty()
  reason!: string;

  @ApiProperty({ enum: LeaveRequestStatus })
  status!: LeaveRequestStatus;

  @ApiProperty({ nullable: true })
  approverId!: string | null;

  @ApiProperty({ nullable: true })
  approvedAt!: Date | null;

  @ApiProperty({ nullable: true })
  approverComments!: string | null;

  @ApiProperty()
  createdAt!: Date;

  @ApiProperty()
  updatedAt!: Date;

  constructor(partial: Partial<LeaveRequestEntity>) {
    Object.assign(this, partial);
  }
}
