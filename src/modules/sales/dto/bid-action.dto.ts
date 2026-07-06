import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';

/** Optional approver comments on approve/reject (mirrors leave's RejectLeaveRequestDto). */
export class BidActionDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  approverComments?: string;
}
