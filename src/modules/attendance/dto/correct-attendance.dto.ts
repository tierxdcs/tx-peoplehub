import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsDateString, IsOptional } from 'class-validator';

export class CorrectAttendanceDto {
  @ApiPropertyOptional({ example: '2026-08-10T09:30:00.000Z' })
  @IsOptional()
  @IsDateString()
  checkInTime?: string | null;

  @ApiPropertyOptional({ example: '2026-08-10T18:00:00.000Z' })
  @IsOptional()
  @IsDateString()
  checkOutTime?: string | null;
}
