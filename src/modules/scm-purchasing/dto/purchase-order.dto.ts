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
  Max,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';

/**
 * Shared so the create and edit DTOs cannot describe the same field two
 * different ways in the generated API docs.
 */
const ADVANCE_PERCENT_DESCRIPTION =
  'Advance payable before delivery, as a percentage (0.01–100) of the pre-tax ' +
  'line total. Omit or send null for no advance. Registered supplier/vendor ' +
  'only, and editable only while the PO is a DRAFT.';

const GST_STATE_CODE_DESCRIPTION =
  "The supplier's two-digit GST state code. Defaults to the state in the " +
  "party's GSTIN, or the company's own state when the party has none. Decides " +
  "the split: the company's state is intra-state (CGST + SGST), anywhere else " +
  'is inter-state (IGST).';

/**
 * GST rates are order-level, applied once to the summed line total — the same
 * shape the Sales Voucher posts. They are NOT defaulted server-side: a tax rate
 * is an assertion about the supply, so an omitted rate stays zero and the form
 * is what proposes the 18% slab.
 */
const GST_RATE_DESCRIPTION = (tax: string) =>
  `${tax} %, 0–100, applied once to the summed line total.`;

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
  @ApiPropertyOptional({ description: ADVANCE_PERCENT_DESCRIPTION })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  @Max(100)
  advancePercent?: number | null;

  @ApiPropertyOptional({ description: GST_STATE_CODE_DESCRIPTION })
  @IsOptional()
  @IsString()
  gstStateCode?: string;
  @ApiPropertyOptional({ description: GST_RATE_DESCRIPTION('IGST') })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(100)
  igstRate?: number;
  @ApiPropertyOptional({ description: GST_RATE_DESCRIPTION('CGST') })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(100)
  cgstRate?: number;
  @ApiPropertyOptional({ description: GST_RATE_DESCRIPTION('SGST') })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(100)
  sgstRate?: number;

  @ApiProperty({ type: [PurchaseOrderLineInputDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PurchaseOrderLineInputDto)
  @ArrayMinSize(1)
  lines!: PurchaseOrderLineInputDto[];
}

/** Edit a DRAFT PO. Sending `lines` full-replaces the line set. */
export class UpdatePurchaseOrderDto {
  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  supplierId?: string | null;
  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  vendorId?: string | null;
  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  adHocPartyName?: string | null;
  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  adHocContactInfo?: string | null;
  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  adHocPartyAddress?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsDateString() orderDate?: string;
  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsDateString()
  expectedDeliveryDate?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsString() notes?: string;
  @ApiPropertyOptional({ description: ADVANCE_PERCENT_DESCRIPTION })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  @Max(100)
  advancePercent?: number | null;
  @ApiPropertyOptional({ description: GST_STATE_CODE_DESCRIPTION })
  @IsOptional()
  @IsString()
  gstStateCode?: string;
  @ApiPropertyOptional({ description: GST_RATE_DESCRIPTION('IGST') })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(100)
  igstRate?: number;
  @ApiPropertyOptional({ description: GST_RATE_DESCRIPTION('CGST') })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(100)
  cgstRate?: number;
  @ApiPropertyOptional({ description: GST_RATE_DESCRIPTION('SGST') })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(100)
  sgstRate?: number;
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
