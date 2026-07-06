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

export class CreateOpportunityDto {
  @ApiProperty({ example: 'Globex — LC25 supply' })
  @IsString()
  @MinLength(1)
  name!: string;

  @ApiProperty({ example: 6250000 })
  @IsNumber()
  @Min(0)
  estimatedValue!: number;

  @ApiProperty({ example: '2026-09-30' })
  @IsDateString()
  expectedCloseDate!: string;

  @ApiPropertyOptional({ description: 'Link to an existing customer' })
  @IsOptional()
  @IsUUID()
  customerId?: string;

  @ApiPropertyOptional({
    description:
      'Owning Sales rep. Defaults to the creating user; MANAGER/SUPER_ADMIN may assign another.',
  })
  @IsOptional()
  @IsUUID()
  ownerId?: string;
}
