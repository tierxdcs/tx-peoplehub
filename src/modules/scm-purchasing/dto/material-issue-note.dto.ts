import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsNumber,
  IsOptional,
  IsString,
  Min,
  MinLength,
} from 'class-validator';

/**
 * Issue material against an indent. Issuing LESS than requested is explicitly
 * allowed (short issue) — the indent moves to PARTIALLY_ISSUED. The store
 * location is where the stock is drawn from (generating a STOCK_OUT there).
 */
export class CreateMaterialIssueDto {
  @ApiProperty() @IsString() @MinLength(1) materialIndentId!: string;

  @ApiProperty({ description: 'Store location the stock is issued from' })
  @IsString()
  @MinLength(1)
  storeLocationId!: string;

  @ApiProperty({ description: 'Quantity issued (may be less than requested)' })
  @IsNumber({ maxDecimalPlaces: 4 })
  @Min(0)
  issuedQuantity!: number;

  @ApiPropertyOptional({ description: 'Free-text bin location within the store' })
  @IsOptional()
  @IsString()
  binLocation?: string;

  @ApiPropertyOptional() @IsOptional() @IsString() notes?: string;
}
