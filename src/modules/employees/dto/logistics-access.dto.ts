import { ApiProperty } from '@nestjs/swagger';
import { LogisticsAccessLevel } from '@prisma/client';
import { IsDateString, IsEnum } from 'class-validator';

export class LogisticsAccessDto {
  @ApiProperty({ enum: LogisticsAccessLevel })
  @IsEnum(LogisticsAccessLevel)
  level!: LogisticsAccessLevel;

  @ApiProperty({ description: 'Inclusive grant start (ISO timestamp)' })
  @IsDateString()
  startsAt!: string;

  @ApiProperty({ description: 'Exclusive grant expiry (ISO timestamp)' })
  @IsDateString()
  expiresAt!: string;
}
