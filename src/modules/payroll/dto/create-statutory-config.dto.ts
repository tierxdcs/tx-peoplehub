import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { StatutoryConfigType } from '@prisma/client';
import {
  IsDateString,
  IsEnum,
  IsObject,
  IsOptional,
  IsString,
  MinLength,
} from 'class-validator';

export class CreateStatutoryConfigDto {
  @ApiProperty({ enum: StatutoryConfigType })
  @IsEnum(StatutoryConfigType)
  configType!: StatutoryConfigType;

  @ApiPropertyOptional({
    description: 'Required (and only meaningful) for PROFESSIONAL_TAX',
  })
  @IsOptional()
  @IsString()
  state?: string;

  @ApiProperty({ example: '2026-04-01' })
  @IsDateString()
  effectiveFrom!: string;

  @ApiPropertyOptional({ example: '2027-03-31' })
  @IsOptional()
  @IsDateString()
  effectiveTo?: string;

  @ApiProperty({
    description:
      'Shape depends on configType — see StatutoryConfigService for the required fields per type',
  })
  @IsObject()
  configData!: Record<string, unknown>;

  @ApiProperty({
    example: 'EPFO circular dated 2026-03-15, confirmed by CA Firm XYZ',
    description: 'Where this rate came from / who approved it',
  })
  @IsString()
  @MinLength(1)
  sourceNote!: string;
}
