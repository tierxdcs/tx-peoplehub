import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsDateString,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';

export class PurchaseOrderLineInputDto {
  @ApiProperty() @IsString() @MinLength(1) itemId!: string;
  @ApiProperty({ description: 'Ordered quantity' })
  @IsNumber({ maxDecimalPlaces: 4 })
  @Min(0)
  orderedQuantity!: number;
  @ApiProperty({ description: 'Unit price' })
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  unitPrice!: number;
  @ApiPropertyOptional({
    description:
      'UoM snapshot; defaults to the Item’s base unit of measure if omitted.',
  })
  @IsOptional()
  @IsString()
  unitOfMeasure?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() notes?: string;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) sequence?: number;
}

export class CreatePurchaseOrderDto {
  /** Exactly ONE of supplierId / vendorId must be provided (enforced in service). */
  @ApiPropertyOptional() @IsOptional() @IsString() supplierId?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() vendorId?: string;

  @ApiPropertyOptional({ description: 'ISO date; defaults to now' })
  @IsOptional()
  @IsDateString()
  orderDate?: string;
  @ApiPropertyOptional({ description: 'ISO date' })
  @IsOptional()
  @IsDateString()
  expectedDeliveryDate?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() notes?: string;

  @ApiProperty({ type: [PurchaseOrderLineInputDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PurchaseOrderLineInputDto)
  @ArrayMinSize(1)
  lines!: PurchaseOrderLineInputDto[];
}

/** Edit a DRAFT PO. Sending `lines` full-replaces the line set. */
export class UpdatePurchaseOrderDto {
  @ApiPropertyOptional() @IsOptional() @IsString() supplierId?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() vendorId?: string;
  @ApiPropertyOptional() @IsOptional() @IsDateString() orderDate?: string;
  @ApiPropertyOptional() @IsOptional() @IsDateString() expectedDeliveryDate?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() notes?: string;
  @ApiPropertyOptional({ type: [PurchaseOrderLineInputDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PurchaseOrderLineInputDto)
  @ArrayMinSize(1)
  lines?: PurchaseOrderLineInputDto[];
}
