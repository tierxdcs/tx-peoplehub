import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  IsUUID,
  ValidateNested,
} from 'class-validator';

/**
 * A line on an internal order describes what is being built (real Product or
 * an ad-hoc name/description + quantity). There is deliberately NO price input — an internal order has no
 * pricing behind it, so unit price / line total / order total are all zero
 * until (and unless) the order is promoted to a real customer order.
 */
export class InternalOrderLineItemDto {
  @ApiPropertyOptional({
    description:
      'Existing Product. Omit for an ad-hoc line and provide adHocProductName instead.',
  })
  @IsOptional()
  @IsUUID()
  productId?: string;

  @ApiPropertyOptional({ description: 'Unresolved product name.' })
  @IsOptional()
  @IsString()
  adHocProductName?: string;

  @ApiPropertyOptional({ description: 'Optional ad-hoc product description.' })
  @IsOptional()
  @IsString()
  adHocDescription?: string;

  @ApiProperty({ example: 10 })
  @IsNumber()
  @IsPositive()
  quantity!: number;
}

/**
 * Create an INTERNAL order directly (no Bid, OCS, or committed customer).
 * Creatable by Sales, R&D, or Project Manager staff (see
 * SalesAccessService.assertCanCreateInternalOrder).
 */
export class CreateInternalOrderDto {
  @ApiPropertyOptional({
    description:
      'Optional prospective customer — a non-committal tag (e.g. "sample for X"), not a commercial commitment. Links to a real Customer record if set.',
  })
  @IsOptional()
  @IsUUID()
  customerId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  businessUnitId?: string;

  @ApiProperty({ type: [InternalOrderLineItemDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => InternalOrderLineItemDto)
  lineItems!: InternalOrderLineItemDto[];
}
