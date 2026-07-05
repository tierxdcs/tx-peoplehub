import { ApiProperty } from '@nestjs/swagger';
import {
  IsDateString,
  IsNumber,
  IsString,
  IsUUID,
  Min,
  MinLength,
} from 'class-validator';

export class CreateLeaveRequestDto {
  @ApiProperty()
  @IsUUID()
  leaveTypeId!: string;

  @ApiProperty({ example: '2026-08-10' })
  @IsDateString()
  startDate!: string;

  @ApiProperty({ example: '2026-08-12' })
  @IsDateString()
  endDate!: string;

  @ApiProperty({
    example: 2.5,
    description: 'Positive multiple of 0.5, not exceeding the calendar span',
  })
  @IsNumber()
  @Min(0.5)
  numberOfDays!: number;

  @ApiProperty({ example: 'Family function' })
  @IsString()
  @MinLength(1)
  reason!: string;
}
