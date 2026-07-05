import { ApiProperty } from '@nestjs/swagger';
import { PayrollRunStatus } from '@prisma/client';

export class PayrollRunEntity {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  month!: number;

  @ApiProperty()
  year!: number;

  @ApiProperty({ enum: PayrollRunStatus })
  status!: PayrollRunStatus;

  @ApiProperty()
  initiatedById!: string;

  @ApiProperty({ nullable: true })
  processedAt!: Date | null;

  @ApiProperty({ nullable: true })
  lockedAt!: Date | null;

  @ApiProperty()
  createdAt!: Date;

  constructor(partial: Partial<PayrollRunEntity>) {
    Object.assign(this, partial);
  }
}
