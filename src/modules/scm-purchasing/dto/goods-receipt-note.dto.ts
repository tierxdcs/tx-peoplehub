import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { PackingCondition } from '@prisma/client';
import {
  ArrayMinSize,
  IsArray,
  IsDateString,
  IsEnum,
  IsInt,
  IsOptional,
  IsNumber,
  IsString,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';

/**
 * Logistics / sign-off details captured at the GRN gate (spec §3.1). Shared by
 * create + update; every field is optional and nullable. These are dedicated,
 * queryable columns — they are NOT stuffed into the free-text `notes` field.
 */
export class GrnLogisticsFieldsDto {
  @ApiPropertyOptional() @IsOptional() @IsString() vendorDeliveryChallanNumber?: string;
  @ApiPropertyOptional({ description: 'ISO date' })
  @IsOptional()
  @IsDateString()
  deliveryChallanDate?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() vehicleOrAwbNumber?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() driverOrCourier?: string;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) totalPackagesReceived?: number;
  @ApiPropertyOptional({ enum: PackingCondition })
  @IsOptional()
  @IsEnum(PackingCondition)
  packingCondition?: PackingCondition;
  @ApiPropertyOptional({ description: 'Employee id of the signing-off supervisor' })
  @IsOptional()
  @IsString()
  supervisorSignOffId?: string;
}

export class GoodsReceiptNoteLineInputDto {
  @ApiProperty({ description: 'The PurchaseOrderLine this receipt is against' })
  @IsString()
  @MinLength(1)
  purchaseOrderLineId!: string;

  @ApiProperty({ description: 'Store location the goods land in on QC pass' })
  @IsString()
  @MinLength(1)
  storeLocationId!: string;

  @ApiProperty({ description: 'Quantity physically received' })
  @IsNumber({ maxDecimalPlaces: 4 })
  @Min(0)
  receivedQuantity!: number;

  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) sequence?: number;
}

export class CreateGoodsReceiptNoteDto extends GrnLogisticsFieldsDto {
  @ApiProperty() @IsString() @MinLength(1) purchaseOrderId!: string;

  @ApiPropertyOptional({ description: 'ISO date; defaults to now' })
  @IsOptional()
  @IsDateString()
  receivedDate?: string;

  @ApiPropertyOptional({ description: 'Free-text receiving remarks' })
  @IsOptional()
  @IsString()
  notes?: string;

  @ApiProperty({ type: [GoodsReceiptNoteLineInputDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => GoodsReceiptNoteLineInputDto)
  @ArrayMinSize(1)
  lines!: GoodsReceiptNoteLineInputDto[];
}

/** Edit a DRAFT GRN. Sending `lines` full-replaces the line set. */
export class UpdateGoodsReceiptNoteDto extends GrnLogisticsFieldsDto {
  @ApiPropertyOptional() @IsOptional() @IsDateString() receivedDate?: string;
  @ApiPropertyOptional({ description: 'Free-text receiving remarks' })
  @IsOptional()
  @IsString()
  notes?: string;
  @ApiPropertyOptional({ type: [GoodsReceiptNoteLineInputDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => GoodsReceiptNoteLineInputDto)
  @ArrayMinSize(1)
  lines?: GoodsReceiptNoteLineInputDto[];
}

/** One line's QC decision. accepted + rejected must equal the received qty. */
export class QcInspectionLineDto {
  @ApiProperty() @IsString() @MinLength(1) grnLineId!: string;

  @ApiProperty({ description: 'Quantity that passed QC and enters stock' })
  @IsNumber({ maxDecimalPlaces: 4 })
  @Min(0)
  acceptedQuantity!: number;

  @ApiProperty({ description: 'Quantity that failed QC (never enters stock)' })
  @IsNumber({ maxDecimalPlaces: 4 })
  @Min(0)
  rejectedQuantity!: number;

  @ApiPropertyOptional({ description: 'Required when rejectedQuantity > 0' })
  @IsOptional()
  @IsString()
  rejectionReason?: string;
}

/**
 * Finalize the QC gate on a PENDING_QC GRN. Every line must be decided.
 * Accepted quantity generates a STOCK_IN; rejected quantity spawns an NCR.
 */
export class FinalizeQcDto {
  @ApiProperty({ type: [QcInspectionLineDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => QcInspectionLineDto)
  @ArrayMinSize(1)
  lines!: QcInspectionLineDto[];
}
