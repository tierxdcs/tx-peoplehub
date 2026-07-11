import { ApiProperty } from '@nestjs/swagger';
import { IsOptional, IsString, MinLength } from 'class-validator';

/**
 * Query for the live-search employee picker (share dialogs etc.). A short
 * free-text term matched against name/email; capped result set, not paginated —
 * it's a type-ahead, not a browse. Available to any authenticated employee.
 */
export class EmployeeSearchQueryDto {
  @ApiProperty({ description: 'Free-text term matched against name/email' })
  @IsString()
  @MinLength(1)
  q!: string;

  @ApiProperty({
    required: false,
    description: 'Max results (default 10, cap 25)',
  })
  @IsOptional()
  @IsString()
  limit?: string;
}
