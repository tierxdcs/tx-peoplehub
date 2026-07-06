import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { SalesTaxType } from '@prisma/client';
import {
  IsDateString,
  IsEnum,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  Min,
  MinLength,
} from 'class-validator';

export class CreateTaxConfigDto {
  @ApiProperty({ enum: SalesTaxType })
  @IsEnum(SalesTaxType)
  taxType!: SalesTaxType;

  @ApiProperty({ example: 18, description: 'Percentage (e.g. 18 = 18%)' })
  @IsNumber()
  @Min(0)
  @Max(100)
  rate!: number;

  @ApiProperty({ example: '2026-04-01' })
  @IsDateString()
  effectiveFrom!: string;

  @ApiPropertyOptional({ example: '2027-03-31' })
  @IsOptional()
  @IsDateString()
  effectiveTo?: string;

  @ApiProperty({
    example: 'CBIC notification 2026-03; verified by Finance',
    description: 'Where this rate came from / who approved it',
  })
  @IsString()
  @MinLength(1)
  sourceNote!: string;
}
