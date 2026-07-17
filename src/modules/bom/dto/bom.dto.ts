import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import {
  BomLineSource,
  ItemType,
  StockBucket,
} from '@prisma/client';

// ── Item Master ──────────────────────────────────────────────────────
export class CreateItemDto {
  @ApiProperty() @IsString() @MinLength(1) itemCode!: string;
  @ApiProperty() @IsString() @MinLength(1) name!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() description?: string;
  @ApiProperty({ enum: ItemType }) @IsEnum(ItemType) itemType!: ItemType;
  @ApiProperty() @IsString() @MinLength(1) baseUnitOfMeasure!: string;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isActive?: boolean;
  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(100)
  defaultWastagePercent?: number;
  @ApiPropertyOptional() @IsOptional() @IsString() drawingSpecReference?: string;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) standardLeadTimeDays?: number;
}

/** All fields optional; itemCode is immutable (not editable) once created. */
export class UpdateItemDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MinLength(1) name?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() description?: string;
  @ApiPropertyOptional({ enum: ItemType }) @IsOptional() @IsEnum(ItemType) itemType?: ItemType;
  @ApiPropertyOptional() @IsOptional() @IsString() @MinLength(1) baseUnitOfMeasure?: string;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isActive?: boolean;
  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(100)
  defaultWastagePercent?: number;
  @ApiPropertyOptional() @IsOptional() @IsString() drawingSpecReference?: string;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) standardLeadTimeDays?: number;
}

// ── BOM ──────────────────────────────────────────────────────────────
export class BomLineInputDto {
  @ApiProperty() @IsString() @MinLength(1) itemId!: string;
  @ApiProperty({ description: 'Quantity per one finished product unit' })
  @IsNumber({ maxDecimalPlaces: 4 })
  @Min(0)
  quantityPerUnit!: number;
  @ApiProperty() @IsString() @MinLength(1) unitOfMeasure!: string;
  @ApiPropertyOptional({ default: 0 })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(100)
  wastagePercent?: number;
  @ApiPropertyOptional({ enum: BomLineSource })
  @IsOptional()
  @IsEnum(BomLineSource)
  makeBuy?: BomLineSource;
  @ApiPropertyOptional() @IsOptional() @IsString() notes?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() drawingSpecReference?: string;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) sequence?: number;
}

export class CreateBomDto {
  @ApiProperty() @IsString() @MinLength(1) productId!: string;
  @ApiPropertyOptional() @IsOptional() @IsDateString() effectiveDate?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() revisionNotes?: string;
  @ApiProperty({ type: [BomLineInputDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => BomLineInputDto)
  @ArrayMinSize(0)
  lines!: BomLineInputDto[];
}

/** Edit a DRAFT or REJECTED BOM. Full-replace of lines when `lines` is sent. */
export class UpdateBomDto {
  @ApiPropertyOptional() @IsOptional() @IsDateString() effectiveDate?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() revisionNotes?: string;
  @ApiPropertyOptional({ type: [BomLineInputDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => BomLineInputDto)
  lines?: BomLineInputDto[];
}

export class RejectBomDto {
  @ApiProperty({ description: 'Required non-empty rejection comment' })
  @IsString()
  @MinLength(1)
  comment!: string;
}

// ── Inventory ────────────────────────────────────────────────────────
export class StockAdjustmentDto {
  @ApiProperty() @IsString() @MinLength(1) itemId!: string;
  @ApiProperty() @IsString() @MinLength(1) storeLocationId!: string;
  @ApiPropertyOptional({ enum: StockBucket, default: StockBucket.ON_HAND })
  @IsOptional()
  @IsEnum(StockBucket)
  bucket?: StockBucket;
  @ApiProperty({ description: 'Signed delta (positive = increase)' })
  @IsNumber({ maxDecimalPlaces: 4 })
  quantityChange!: number;
  @ApiProperty() @IsString() @MinLength(1) reason!: string;
  @ApiPropertyOptional({ description: 'Set/replace expected receipt qty' })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 4 })
  @Min(0)
  expectedReceiptQuantity?: number;
  @ApiPropertyOptional() @IsOptional() @IsDateString() expectedReceiptDate?: string;
}

// ── Reservations ─────────────────────────────────────────────────────
export class CreateReservationDto {
  @ApiProperty() @IsString() @MinLength(1) itemId!: string;
  @ApiProperty() @IsString() @MinLength(1) storeLocationId!: string;
  @ApiProperty() @IsNumber({ maxDecimalPlaces: 4 }) @Min(0) quantity!: number;
  @ApiPropertyOptional({
    description:
      'Allow the reservation to exceed currently-available stock (explicit override).',
    default: false,
  })
  @IsOptional()
  @IsBoolean()
  allowOverride?: boolean;
}
