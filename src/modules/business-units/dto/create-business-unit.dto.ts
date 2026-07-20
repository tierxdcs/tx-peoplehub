import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  MinLength,
} from 'class-validator';

export class CreateBusinessUnitDto {
  @ApiProperty({ example: 'Phaze Edge' })
  @IsString()
  @MinLength(2)
  name!: string;

  @ApiProperty({ example: 'EDGE', description: 'Short code, used for matching' })
  @IsString()
  @MinLength(2)
  code!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @ApiPropertyOptional({ default: 0, description: 'Sort order in dropdowns' })
  @IsOptional()
  @IsInt()
  displayOrder?: number;

  @ApiPropertyOptional({ example: '#2563EB' })
  @IsOptional()
  @IsString()
  colorHex?: string;
}
