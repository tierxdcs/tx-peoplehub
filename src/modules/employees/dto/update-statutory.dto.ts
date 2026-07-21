import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MinLength } from 'class-validator';

/**
 * Add or replace an employee's statutory info (a full replacement, same shape
 * as onboarding). PAN / PF / ESIC are encrypted at rest; only the last 4
 * digits of Aadhaar are ever stored.
 */
export class UpdateStatutoryDto {
  @ApiProperty({ example: 'ABCDE1234F' })
  @IsString()
  @MinLength(4)
  panNumber!: string;

  @ApiProperty({ example: '1234', description: 'Last 4 digits only' })
  @IsString()
  @MinLength(4)
  aadhaarLast4!: string;

  @ApiProperty({ example: 'PF1234567890' })
  @IsString()
  @MinLength(4)
  pfAccountNumber!: string;

  @ApiPropertyOptional({ example: 'ESIC1234567890' })
  @IsOptional()
  @IsString()
  esicNumber?: string;
}
