import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsDateString,
  IsNumber,
  IsOptional,
  IsUUID,
  Min,
} from 'class-validator';

export class CreateSalaryStructureDto {
  @ApiProperty()
  @IsUUID()
  employeeId!: string;

  @ApiProperty({ example: '2026-08-01' })
  @IsDateString()
  effectiveFrom!: string;

  @ApiProperty({ example: 50000 })
  @IsNumber()
  @Min(0)
  basic!: number;

  @ApiProperty({ example: 10000 })
  @IsNumber()
  @Min(0)
  hra!: number;

  @ApiPropertyOptional({ example: 5000, default: 0 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  specialAllowance?: number;

  @ApiPropertyOptional({ example: 2000 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  otherAllowances?: number;

  @ApiProperty({
    example: 780000,
    description: 'Annual CTC — stored for reference, not derived automatically',
  })
  @IsNumber()
  @Min(0)
  ctcAnnual!: number;
}
