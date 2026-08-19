import { ApiProperty } from '@nestjs/swagger';
import { IsDateString, IsNumber, Min } from 'class-validator';

export class CtcPreviewDto {
  @ApiProperty({ example: 35195, description: 'Target monthly CTC in INR' })
  @IsNumber()
  @Min(1)
  monthlyCtc!: number;

  @ApiProperty({ example: '2026-08-19' })
  @IsDateString()
  effectiveDate!: string;
}
