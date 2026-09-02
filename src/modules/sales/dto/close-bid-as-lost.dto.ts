import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

/**
 * Closing a bid as LOST always carries a reason. It is the one commercial
 * outcome nobody records voluntarily, so the reason is mandatory rather than
 * optional — a bare status flip leaves no way to answer "why do we keep losing
 * these?" later.
 */
export class CloseBidAsLostDto {
  @ApiProperty({
    description: 'Why the bid was lost (e.g. "Lost to competitor on price")',
    maxLength: 1000,
  })
  @IsString()
  @IsNotEmpty({ message: 'lostReason is required when closing a bid as lost' })
  @MaxLength(1000)
  lostReason!: string;
}
