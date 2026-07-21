import { ApiProperty } from '@nestjs/swagger';
import { IsString, MinLength } from 'class-validator';

/**
 * Add or replace an employee's bank details (a full replacement — both fields
 * required, same shape as onboarding). The account number is encrypted at rest.
 */
export class UpdateBankDetailsDto {
  @ApiProperty({ example: '000123456789' })
  @IsString()
  @MinLength(4)
  bankAccountNumber!: string;

  @ApiProperty({ example: 'HDFC0001234' })
  @IsString()
  ifscCode!: string;
}
