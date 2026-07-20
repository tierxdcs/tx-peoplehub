import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  MinLength,
} from 'class-validator';

/**
 * Edit a business unit. `code` is immutable (it's referenced by the keyword-rule
 * config and used for matching), so it is intentionally absent. Setting
 * `isActive: false` soft-disables the unit — it disappears from the new-product
 * dropdown but products already tagged with it are unaffected.
 */
export class UpdateBusinessUnitDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MinLength(2)
  name?: string;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  description?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  displayOrder?: number;

  @ApiPropertyOptional({ example: '#2563EB' })
  @IsOptional()
  @IsString()
  colorHex?: string;
}
