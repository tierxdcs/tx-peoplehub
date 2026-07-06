import { ApiProperty } from '@nestjs/swagger';
import { BidStatus } from '@prisma/client';
import { IsEnum } from 'class-validator';

/** Rep-driven bid transitions: APPROVED->SENT, SENT->ACCEPTED/EXPIRED. */
export class BidStatusDto {
  @ApiProperty({ enum: BidStatus })
  @IsEnum(BidStatus)
  status!: BidStatus;
}
