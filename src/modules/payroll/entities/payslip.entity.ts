import { ApiProperty } from '@nestjs/swagger';
import { PayslipStatus } from '@prisma/client';

export class PayslipEntity {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  payrollRunId!: string;

  @ApiProperty()
  employeeId!: string;

  @ApiProperty()
  grossEarnings!: string;

  @ApiProperty()
  basicPaid!: string;

  @ApiProperty()
  hraPaid!: string;

  @ApiProperty()
  specialAllowancePaid!: string;

  @ApiProperty()
  otherAllowancesPaid!: string;

  @ApiProperty()
  pfEmployee!: string;

  @ApiProperty()
  pfEmployer!: string;

  @ApiProperty({ nullable: true })
  esiEmployee!: string | null;

  @ApiProperty({ nullable: true })
  esiEmployer!: string | null;

  @ApiProperty({ nullable: true })
  professionalTax!: string | null;

  @ApiProperty()
  tdsDeducted!: string;

  @ApiProperty()
  unpaidLeaveDeduction!: string;

  @ApiProperty()
  netPay!: string;

  @ApiProperty()
  statutoryConfigSnapshot!: Record<string, unknown>;

  @ApiProperty({ enum: PayslipStatus })
  status!: PayslipStatus;

  @ApiProperty()
  createdAt!: Date;

  constructor(partial: Partial<PayslipEntity>) {
    Object.assign(this, partial);
  }
}
