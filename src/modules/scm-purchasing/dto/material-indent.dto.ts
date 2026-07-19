import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsDateString,
  IsNumber,
  IsOptional,
  IsString,
  Min,
  MinLength,
} from 'class-validator';

export class CreateMaterialIndentDto {
  @ApiProperty() @IsString() @MinLength(1) itemId!: string;

  @ApiProperty({ description: 'Requested quantity' })
  @IsNumber({ maxDecimalPlaces: 4 })
  @Min(0)
  requestedQuantity!: number;

  @ApiPropertyOptional({
    description:
      'Project kickoff this material is for. Enables drawing on that project’s reservations when issuing.',
  })
  @IsOptional()
  @IsString()
  projectKickoffId?: string;

  @ApiPropertyOptional({ description: 'ISO date' })
  @IsOptional()
  @IsDateString()
  requiredByDate?: string;

  @ApiPropertyOptional() @IsOptional() @IsString() notes?: string;
}
