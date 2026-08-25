import { Type } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsArray,
  IsOptional,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator';

/**
 * Customer-facing display override for one order line — the customer's own
 * PO wording. Display-only: the underlying Product/Item link, BOM, costing
 * and PLM are untouched. Empty strings are normalized to null (cleared).
 */
export class UpdateLineCustomerFacingDto {
  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(300)
  customerFacingProductName?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  customerFacingDescription?: string | null;
}

export class ConvertBidLineOverrideDto {
  /** The BID line this override applies to (order lines don't exist yet). */
  @IsString() bidLineItemId!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(300)
  customerFacingProductName?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  customerFacingDescription?: string;
}

/** Optional body for POST /bids/:id/convert-to-order — per-line customer
 * wording captured before the order number is even allocated. */
export class ConvertBidToOrderDto {
  @ApiPropertyOptional({ type: [ConvertBidLineOverrideDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ConvertBidLineOverrideDto)
  lineOverrides?: ConvertBidLineOverrideDto[];
}
