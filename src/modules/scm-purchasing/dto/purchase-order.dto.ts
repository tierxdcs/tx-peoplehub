import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsDateString,
  IsEmail,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';

export class PurchaseOrderLineInputDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MinLength(1)
  itemId?: string;
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MinLength(1)
  adHocItemName?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() adHocDescription?: string;
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
  /** At most one may be supplied. Neither means an ad-hoc party PO. */
  @ApiPropertyOptional() @IsOptional() @IsString() supplierId?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() vendorId?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() adHocPartyName?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() adHocContactInfo?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() adHocPartyAddress?: string;

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
  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  expectedDeliveryDate?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() notes?: string;
  @ApiPropertyOptional({ type: [PurchaseOrderLineInputDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PurchaseOrderLineInputDto)
  @ArrayMinSize(1)
  lines?: PurchaseOrderLineInputDto[];
}

export class RejectAdHocPurchaseOrderDto {
  @ApiProperty() @IsString() @MinLength(1) comment!: string;
}

/** Email an issued PO (with the order PDF attached) to the supplier/vendor. */
export class EmailPurchaseOrderDto {
  @ApiPropertyOptional({
    description:
      "Recipient override. Defaults to the registered partner's contactEmail; required for an ad-hoc party, which has none.",
  })
  @IsOptional()
  @IsEmail()
  to?: string;

  @ApiPropertyOptional({
    description: 'Free-text note added to the covering email.',
  })
  @IsOptional()
  @IsString()
  note?: string;
}
