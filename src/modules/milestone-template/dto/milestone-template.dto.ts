import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { OrderLineDeliveryType } from '@prisma/client';
import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

export class CreateMilestoneTemplateDto {
  @ApiProperty({ enum: OrderLineDeliveryType })
  @IsEnum(OrderLineDeliveryType)
  flowType!: OrderLineDeliveryType;

  @ApiProperty()
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name!: string;

  @ApiPropertyOptional({
    description:
      'Sort position within the flow type (ascending). Defaults to 0.',
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  displayOrder?: number;
}

export class UpdateMilestoneTemplateDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(0)
  displayOrder?: number;

  @ApiPropertyOptional({
    description: 'Soft deactivate — hides from the dropdown.',
  })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
