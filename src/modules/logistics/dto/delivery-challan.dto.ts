import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { TransportMode } from '@prisma/client';
import {
  ArrayMinSize,
  IsArray,
  IsDateString,
  IsEnum,
  IsIn,
  IsInt,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';

export class DeliveryChallanLineInputDto {
  @ApiProperty({ description: 'The order line this dispatched quantity belongs to' })
  @IsString()
  @MinLength(1)
  orderLineId!: string;

  @ApiProperty({ description: 'Quantity dispatched in this DC' })
  @IsNumber({ maxDecimalPlaces: 4 })
  @Min(0)
  quantity!: number;

  @ApiPropertyOptional({ description: 'Override the item description; defaults from the product' })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) sequence?: number;
}

export class CreateDeliveryChallanDto {
  @ApiProperty() @IsString() @MinLength(1) orderId!: string;

  @ApiPropertyOptional({ description: 'ISO date; defaults to now' })
  @IsOptional()
  @IsDateString()
  dispatchDate?: string;

  @ApiPropertyOptional() @IsOptional() @IsString() customerPoReference?: string;

  @ApiProperty() @IsString() @MinLength(1) consigneeName!: string;
  @ApiProperty() @IsString() @MinLength(1) consigneeAddress!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() consigneeGstin?: string;
  @ApiProperty({ description: 'Two-digit GST state code; drives place-of-supply' })
  @IsString()
  @MinLength(1)
  consigneeStateCode!: string;

  @ApiProperty({ enum: TransportMode })
  @IsEnum(TransportMode)
  transportMode!: TransportMode;
  @ApiPropertyOptional() @IsOptional() @IsString() transporterName?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() vehicleOrAwbNumber?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() driverName?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() driverPhone?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() specialDeliveryInstructions?: string;
  @ApiPropertyOptional({ description: 'Documents-included checklist as a JSON map' })
  @IsOptional()
  @IsObject()
  documentsIncluded?: Record<string, boolean>;

  @ApiPropertyOptional({ description: 'ISO date — captured for OTD tracking' })
  @IsOptional()
  @IsDateString()
  promisedDeliveryDate?: string;

  @ApiProperty({ type: [DeliveryChallanLineInputDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => DeliveryChallanLineInputDto)
  @ArrayMinSize(1)
  lines!: DeliveryChallanLineInputDto[];
}

/** Edit a DRAFT delivery challan. Sending `lines` full-replaces the line set. */
export class UpdateDeliveryChallanDto {
  @ApiPropertyOptional() @IsOptional() @IsDateString() dispatchDate?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() customerPoReference?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() consigneeName?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() consigneeAddress?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() consigneeGstin?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() consigneeStateCode?: string;
  @ApiPropertyOptional({ enum: TransportMode })
  @IsOptional()
  @IsEnum(TransportMode)
  transportMode?: TransportMode;
  @ApiPropertyOptional() @IsOptional() @IsString() transporterName?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() vehicleOrAwbNumber?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() driverName?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() driverPhone?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() specialDeliveryInstructions?: string;
  @ApiPropertyOptional() @IsOptional() @IsObject() documentsIncluded?: Record<string, boolean>;
  @ApiPropertyOptional() @IsOptional() @IsDateString() promisedDeliveryDate?: string;
  @ApiPropertyOptional({ type: [DeliveryChallanLineInputDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => DeliveryChallanLineInputDto)
  @ArrayMinSize(1)
  lines?: DeliveryChallanLineInputDto[];
}

/** E-way bill details, entered manually after generating on the GST portal. */
export class EwayBillDto {
  @ApiProperty() @IsString() @MinLength(1) eWayBillNumber!: string;
  @ApiPropertyOptional({ description: 'ISO date' })
  @IsOptional()
  @IsDateString()
  eWayBillDate?: string;
  @ApiPropertyOptional({ description: 'ISO date' })
  @IsOptional()
  @IsDateString()
  eWayBillValidUntil?: string;
}

/** POD metadata confirmed after the signed document is uploaded to R2. */
export class ConfirmPodDto {
  @ApiProperty({ description: 'Uploaded file name (extension-checked)' })
  @IsString()
  @MinLength(1)
  fileName!: string;
  @ApiProperty({ description: 'Declared upload size in bytes (cap-checked)' })
  @Type(() => Number)
  @IsInt()
  @Min(0)
  sizeBytes!: number;
  @ApiPropertyOptional() @IsOptional() @IsString() podReceivedBy?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() podNotes?: string;
  @ApiPropertyOptional({ description: 'ISO date; defaults to now' })
  @IsOptional()
  @IsDateString()
  actualDeliveryDate?: string;
}

export class UpdateDcStatusDto {
  @ApiProperty({ enum: ['IN_TRANSIT', 'DELIVERED'] })
  @IsIn(['IN_TRANSIT', 'DELIVERED'])
  status!: 'IN_TRANSIT' | 'DELIVERED';
}
