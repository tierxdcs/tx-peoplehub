import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsNumber,
  IsPositive,
  IsUUID,
  ValidateNested,
} from 'class-validator';

/** One reconciled line the customer actually ordered (product + quantity). */
export class PromoteLineItemDto {
  @ApiProperty()
  @IsUUID()
  productId!: string;

  @ApiProperty({ example: 10 })
  @IsNumber()
  @IsPositive()
  quantity!: number;
}

/**
 * Promote an existing INTERNAL order to a real CUSTOMER order when a Bid is
 * won, instead of creating a brand-new order — preserving the internal order's
 * Kickoff/PLM/Kanban history. `lineItems` is the promoter's CONFIRMED reconciled
 * (bid-priced) final set: it is matched to the internal order by productId
 * (matched lines are updated in place so their PLM trackers survive; new bid
 * products are added), and pricing is taken from the won bid. A dropped internal
 * line that already has PLM work is kept untouched (never deleted) so its design
 * work is preserved; dropped lines without PLM work are deleted.
 */
export class PromoteInternalOrderDto {
  @ApiProperty({ description: 'The existing INTERNAL order to promote.' })
  @IsUUID()
  orderId!: string;

  @ApiProperty({ type: [PromoteLineItemDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => PromoteLineItemDto)
  lineItems!: PromoteLineItemDto[];
}
