import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';

export class RejectLeaveRequestDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  approverComments?: string;
}
