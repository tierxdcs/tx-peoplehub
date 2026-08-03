import { ApiProperty } from '@nestjs/swagger';
import { IsUUID } from 'class-validator';

/**
 * Resolve an ad-hoc bid line item to a real Product before order conversion.
 * The productId must reference an existing, active Product (validated in the
 * service). The line's snapshotted unitPrice/lineTotal are preserved verbatim —
 * the customer was quoted that figure — only productId is set and the ad-hoc
 * placeholder fields are cleared.
 */
export class ResolveBidLineItemDto {
  @ApiProperty({ description: 'The real Product to attach to this line.' })
  @IsUUID()
  productId!: string;
}
