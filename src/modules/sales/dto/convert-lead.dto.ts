import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsDateString,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Min,
  MinLength,
} from 'class-validator';
import { IsAddress } from './is-address.validator';

/**
 * Converts a QUALIFIED lead into an Opportunity. If `customerId` is given
 * the opportunity links to that existing customer; otherwise a Customer is
 * created from the lead's company (owned by the lead's owner).
 */
export class ConvertLeadDto {
  @ApiProperty({
    example: 'Globex — LC25 supply',
    description: 'Opportunity name',
  })
  @IsString()
  @MinLength(1)
  opportunityName!: string;

  @ApiProperty({ example: 6250000 })
  @IsNumber()
  @Min(0)
  estimatedValue!: number;

  @ApiProperty({ example: '2026-09-30' })
  @IsDateString()
  expectedCloseDate!: string;

  @ApiPropertyOptional({
    description:
      'Link to an existing customer; if omitted one is created from the lead.',
  })
  @IsOptional()
  @IsUUID()
  customerId?: string;

  @ApiPropertyOptional({
    description:
      'Billing address for the customer created from this lead (required if no customerId).',
  })
  @IsOptional()
  @IsAddress()
  billingAddress?: Record<string, unknown> | string;
}
