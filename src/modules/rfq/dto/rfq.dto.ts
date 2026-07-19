import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsDateString,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';

export class RfqLineInputDto {
  @ApiProperty() @IsString() @MinLength(1) itemId!: string;
  @ApiProperty() @IsNumber({ maxDecimalPlaces: 4 }) @Min(0) quantity!: number;
  @ApiPropertyOptional({ description: 'UoM; defaults to the Item base unit' })
  @IsOptional()
  @IsString()
  unitOfMeasure?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() specificationNotes?: string;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) sequence?: number;
}

export class CreateRfqDto {
  @ApiProperty() @IsString() @MinLength(1) title!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() description?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() projectKickoffId?: string;
  @ApiProperty({ description: 'ISO timestamp — quote submission deadline' })
  @IsDateString()
  submissionDeadline!: string;
  @ApiPropertyOptional({ description: 'ISO date' })
  @IsOptional()
  @IsDateString()
  requiredByDate?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() deliveryLocation?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() paymentTermsRequested?: string;
  @ApiProperty({ type: [RfqLineInputDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => RfqLineInputDto)
  @ArrayMinSize(1)
  lines!: RfqLineInputDto[];
}

/** Edit a DRAFT RFQ. Sending `lines` full-replaces the line set. */
export class UpdateRfqDto {
  @ApiPropertyOptional() @IsOptional() @IsString() title?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() description?: string;
  @ApiPropertyOptional() @IsOptional() @IsDateString() submissionDeadline?: string;
  @ApiPropertyOptional() @IsOptional() @IsDateString() requiredByDate?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() deliveryLocation?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() paymentTermsRequested?: string;
  @ApiPropertyOptional({ type: [RfqLineInputDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => RfqLineInputDto)
  @ArrayMinSize(1)
  lines?: RfqLineInputDto[];
}

/** Add one invitee (a supplier XOR a vendor) to a DRAFT RFQ. */
export class AddInviteeDto {
  @ApiPropertyOptional() @IsOptional() @IsString() supplierId?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() vendorId?: string;
  @ApiPropertyOptional({
    description: 'Optional access password for the public quote link',
  })
  @IsOptional()
  @IsString()
  @MinLength(1)
  password?: string;
}

/** Award the RFQ to an invitee. Justification is required for a non-lowest award. */
export class AwardRfqDto {
  @ApiProperty() @IsString() @MinLength(1) inviteeId!: string;
  @ApiPropertyOptional({ description: 'Required when NOT awarding the lowest total' })
  @IsOptional()
  @IsString()
  justification?: string;
}

/** Optional weighting for the advisory comparison score (defaults 60/20/20). */
export class ComparisonWeightsDto {
  @ApiPropertyOptional({ default: 60 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  price?: number;
  @ApiPropertyOptional({ default: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  leadTime?: number;
  @ApiPropertyOptional({ default: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  qualification?: number;
}
