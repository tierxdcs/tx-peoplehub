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
}
