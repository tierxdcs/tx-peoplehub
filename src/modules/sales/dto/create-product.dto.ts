import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsNumber,
  IsOptional,
  IsString,
  Min,
  MinLength,
} from 'class-validator';

export class CreateProductDto {
  @ApiProperty({ example: 'LC25-500' })
  @IsString()
  @MinLength(1)
  sku!: string;

  @ApiProperty({ example: 'Liquid Cooling LC25' })
  @IsString()
  @MinLength(1)
  name!: string;

  @ApiProperty({ description: 'Business unit this product belongs to (required)' })
  @IsString()
  @MinLength(1)
  businessUnitId!: string;

  @ApiPropertyOptional({
    default: false,
    description:
      'True when businessUnitId was auto-selected by keyword inference and not yet confirmed by the user.',
  })
  @IsOptional()
  @IsBoolean()
  autoAssignedBusinessUnit?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  description?: string;

  @ApiProperty({ example: 125000 })
  @IsNumber()
  @Min(0)
  unitPrice!: number;

  @ApiProperty({ example: 'each' })
  @IsString()
  @MinLength(1)
  unitOfMeasure!: string;

  @ApiPropertyOptional({ example: '8419' })
  @IsOptional()
  @IsString()
  hsnCode?: string;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  /**
   * The Item Master item this Product is manufactured as (typically a
   * FINISHED_GOOD). BOMs are keyed on Item, so this link is what lets the
   * kickoff stock-availability report resolve the product to a released BOM.
   * Optional — not every product is manufactured in-house.
   */
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  itemId?: string;
}
