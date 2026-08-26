import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsNumber, IsOptional, IsPositive, Max, Min } from 'class-validator';

/**
 * Commercial correction to one order line — the customer PO that arrives after
 * a quotation rarely covers every quoted item at the quoted rate. Quantity and
 * unit price only: the line keeps its id (and therefore its delivery
 * classification / PLM keying), and the Product it points at is never touched.
 * Send either field alone or both; omitting a field leaves it as-is.
 */
export class UpdateOrderLineItemDto {
  @ApiPropertyOptional({
    description: 'New ordered quantity (greater than zero).',
    example: 10,
  })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @IsPositive()
  @Max(999999999999)
  quantity?: number;

  @ApiPropertyOptional({
    description:
      'New unit price. Zero is allowed — an internal order carries no pricing.',
    example: 2500,
  })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(999999999999)
  unitPrice?: number;
}
