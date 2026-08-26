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
  @ApiPropertyOptional({
    description: 'Optional target unit price for this line',
  })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  targetPrice?: number;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) sequence?: number;
}

export class CreateRfqDto {
  @ApiProperty() @IsString() @MinLength(1) title!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() description?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() projectKickoffId?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() customerBomIntakeId?: string;
  @ApiProperty({ description: 'ISO timestamp — quote submission deadline' })
  @IsDateString()
  submissionDeadline!: string;
  @ApiPropertyOptional({ description: 'ISO date' })
  @IsOptional()
  @IsDateString()
  requiredByDate?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() deliveryLocation?: string;
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  paymentTermsRequested?: string;
  @ApiProperty({ type: [RfqLineInputDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => RfqLineInputDto)
  @ArrayMinSize(1)
  lines!: RfqLineInputDto[];
  @ApiPropertyOptional({
    type: [String],
    description:
      "OrderLineItem ids to EXCLUDE from the linked order's context on this " +
      'RFQ. Omit/empty to include every order line (the default).',
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  excludedOrderLineIds?: string[];
}

/** Edit a DRAFT RFQ. Sending `lines` full-replaces the line set. */
export class UpdateRfqDto {
  @ApiPropertyOptional() @IsOptional() @IsString() title?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() description?: string;
  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  submissionDeadline?: string;
  @ApiPropertyOptional() @IsOptional() @IsDateString() requiredByDate?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() deliveryLocation?: string;
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  paymentTermsRequested?: string;
  @ApiPropertyOptional({ type: [RfqLineInputDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => RfqLineInputDto)
  @ArrayMinSize(1)
  lines?: RfqLineInputDto[];
  @ApiPropertyOptional({
    type: [String],
    description:
      'Replaces the excluded-order-line set. Empty array = include all.',
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  excludedOrderLineIds?: string[];
}

/** Reject an RFQ's PM approval. A comment is required (mirrors every other
 * rejection gate in the system, e.g. BOM/expense-claims). */
export class RejectRfqDto {
  @ApiProperty({ description: 'Required non-empty rejection comment' })
  @IsString()
  @MinLength(1)
  comment!: string;
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
  @ApiPropertyOptional({
    description: 'Required when NOT awarding the lowest total',
  })
  @IsOptional()
  @IsString()
  justification?: string;
}

/**
 * Reopen ONE invitee's submission link so they can send a negotiated revised
 * quote after the RFQ has closed. Scoped to that single invitee — never the
 * whole RFQ, so nobody else's sealed round is reopened.
 */
export class RequestQuoteRevisionDto {
  @ApiProperty({
    description:
      'ISO timestamp the reopened link expires at — must be in the future',
  })
  @IsDateString()
  revisionDeadline!: string;
  @ApiPropertyOptional({
    description: 'The negotiation ask, shown to the vendor on the link',
  })
  @IsOptional()
  @IsString()
  note?: string;
  @ApiPropertyOptional({
    description:
      'Optional NEW access password for the reopened link. Omit to keep the ' +
      'password the invitee already has.',
  })
  @IsOptional()
  @IsString()
  @MinLength(1)
  password?: string;
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

export class RfqAttachmentUploadUrlDto {
  @ApiProperty() @IsString() @MinLength(1) fileName!: string;
  @ApiProperty() @IsString() @MinLength(1) mimeType!: string;
  @ApiProperty() @Type(() => Number) @IsInt() @Min(0) fileSize!: number;
  @ApiPropertyOptional() @IsOptional() @IsString() rfqLineId?: string;
}

export class RfqAttachmentConfirmDto {
  @ApiProperty() @IsString() @MinLength(1) fileKey!: string;
  @ApiProperty() @IsString() @MinLength(1) fileName!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() rfqLineId?: string;
}
