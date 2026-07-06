import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsDateString,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';

export class BidLineItemDto {
  @ApiProperty()
  @IsUUID()
  productId!: string;

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

  @ApiPropertyOptional({ description: 'Technical proposal content' })
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
}
