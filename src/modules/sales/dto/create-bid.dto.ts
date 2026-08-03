import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayUnique,
  IsArray,
  IsDateString,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';

/**
 * A bid line is either a real Product (productId set — unit price is snapshotted
 * server-side from Product.unitPrice) OR an ad-hoc placeholder the rep types in
 * (adHocProductName + unitPrice set, productId omitted). Exactly one of the two
 * modes must be used per line — enforced in BidsService.create. Ad-hoc lines
 * must be resolved to a real Product before the bid can convert to an order.
 */
export class BidLineItemDto {
  @ApiPropertyOptional({
    description:
      'Real Product to quote. Omit for an ad-hoc line (supply adHocProductName + unitPrice instead).',
  })
  @IsOptional()
  @IsUUID()
  productId?: string;

  @ApiPropertyOptional({
    description:
      'Ad-hoc placeholder product name — used when no Product exists yet. Mutually exclusive with productId.',
  })
  @IsOptional()
  @IsString()
  @MinLength(1)
  adHocProductName?: string;

  @ApiPropertyOptional({
    description: 'Ad-hoc placeholder description/specification.',
  })
  @IsOptional()
  @IsString()
  adHocDescription?: string;

  @ApiPropertyOptional({
    example: 12500,
    description:
      'Unit price. Required for an ad-hoc line (there is no Product to snapshot from); ignored for a real-product line, which snapshots Product.unitPrice.',
  })
  @IsOptional()
  @IsNumber()
  @Min(0)
  unitPrice?: number;

  @ApiProperty({ example: 500 })
  @IsNumber()
  @Min(0)
  quantity!: number;

  @ApiPropertyOptional({
    example: 5,
    description: 'Per-line discount %, applied before the bid-level discount',
  })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  lineDiscountPercent?: number;
}

export class BidAmcChargeDto {
  @ApiProperty({ enum: [2, 3, 4, 5] })
  @IsInt()
  @IsIn([2, 3, 4, 5])
  yearNumber!: number;

  @ApiProperty({ example: 25000 })
  @IsNumber()
  @Min(0)
  amount!: number;
}

export class CreateBidDto {
  @ApiProperty()
  @IsUUID()
  opportunityId!: string;

  @ApiProperty()
  @IsUUID()
  customerId!: string;

  @ApiProperty({ example: '2026-10-31' })
  @IsDateString()
  validUntil!: string;

  @ApiPropertyOptional({ example: 'TENDER/2026/IND/0042' })
  @IsOptional()
  @IsString()
  tenderReferenceNumber?: string;

  @ApiPropertyOptional({
    example:
      'Submission of quotation for supply of 24U & 42U 800x800 racks, along with MDU',
    description:
      'One-line quotation subject — used in both the Subject line and the opening paragraph.',
  })
  @IsOptional()
  @IsString()
  quotationSubject?: string;

  @ApiPropertyOptional({
    description: 'Internal technical notes (not rendered in the proposal PDF)',
  })
  @IsOptional()
  @IsString()
  technicalSpecification?: string;

  @ApiPropertyOptional({
    description:
      'File metadata only — [{filename, url}]; no upload in this phase',
  })
  @IsOptional()
  @IsArray()
  attachments?: Array<Record<string, unknown>>;

  @ApiPropertyOptional({
    example: 8,
    description:
      'Bid-level discount %. >10 routes the bid for manager approval on submit.',
  })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  discountPercent?: number;

  @ApiProperty({ type: [BidLineItemDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => BidLineItemDto)
  lineItems!: BidLineItemDto[];

  @ApiPropertyOptional({
    type: [BidAmcChargeDto],
    description:
      'Optional flat, untaxed AMC charges for years 2-5. Omit blank years.',
  })
  @IsOptional()
  @IsArray()
  @ArrayUnique((charge: BidAmcChargeDto) => charge.yearNumber)
  @ValidateNested({ each: true })
  @Type(() => BidAmcChargeDto)
  amcCharges?: BidAmcChargeDto[];
}
