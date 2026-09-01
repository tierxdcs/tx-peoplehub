import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { PackingCondition } from '@prisma/client';
import {
  ArrayMinSize,
  IsArray,
  IsDateString,
  IsEnum,
  IsInt,
  IsOptional,
  IsNumber,
  IsString,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';

/**
 * Logistics / sign-off details captured at the GRN gate (spec §3.1). Shared by
 * create + update; every field is optional and nullable. These are dedicated,
 * queryable columns — they are NOT stuffed into the free-text `notes` field.
 */
export class GrnLogisticsFieldsDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  vendorDeliveryChallanNumber?: string;
  @ApiPropertyOptional({ description: 'ISO date' })
  @IsOptional()
  @IsDateString()
  deliveryChallanDate?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() vehicleOrAwbNumber?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() driverOrCourier?: string;
  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(0)
  totalPackagesReceived?: number;
  @ApiPropertyOptional({ enum: PackingCondition })
  @IsOptional()
  @IsEnum(PackingCondition)
  packingCondition?: PackingCondition;
  @ApiPropertyOptional({
    description: 'Employee id of the signing-off supervisor',
  })
  @IsOptional()
  @IsString()
  supervisorSignOffId?: string;
}

export class GoodsReceiptNoteLineInputDto {
  @ApiProperty({ description: 'The PurchaseOrderLine this receipt is against' })
  @IsString()
  @MinLength(1)
  purchaseOrderLineId!: string;

  @ApiProperty({ description: 'Store location the goods land in on QC pass' })
  @IsString()
  @MinLength(1)
  storeLocationId!: string;

  @ApiProperty({ description: 'Quantity physically received' })
  @IsNumber({ maxDecimalPlaces: 4 })
  @Min(0)
  receivedQuantity!: number;

  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) sequence?: number;
}

export class CreateGoodsReceiptNoteDto extends GrnLogisticsFieldsDto {
  @ApiProperty() @IsString() @MinLength(1) purchaseOrderId!: string;

  @ApiPropertyOptional({ description: 'ISO date; defaults to now' })
  @IsOptional()
  @IsDateString()
  receivedDate?: string;

  @ApiPropertyOptional({ description: 'Free-text receiving remarks' })
  @IsOptional()
  @IsString()
  notes?: string;

  @ApiProperty({ type: [GoodsReceiptNoteLineInputDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => GoodsReceiptNoteLineInputDto)
  @ArrayMinSize(1)
  lines!: GoodsReceiptNoteLineInputDto[];
}

/** Edit a DRAFT GRN. Sending `lines` full-replaces the line set. */
export class UpdateGoodsReceiptNoteDto extends GrnLogisticsFieldsDto {
  @ApiPropertyOptional() @IsOptional() @IsDateString() receivedDate?: string;
  @ApiPropertyOptional({ description: 'Free-text receiving remarks' })
  @IsOptional()
  @IsString()
  notes?: string;
  @ApiPropertyOptional({ type: [GoodsReceiptNoteLineInputDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => GoodsReceiptNoteLineInputDto)
  @ArrayMinSize(1)
  lines?: GoodsReceiptNoteLineInputDto[];
}

/**
 * One answer to one question of the line's inspection template. `questionKey` is
 * the QmsTemplateQuestion id. The answer is sent as a string and graded on the
 * server (choice vocabulary, or the question's numeric limits) — the client never
 * decides pass/fail.
 */
export class QcChecklistResponseDto {
  @ApiProperty({ description: 'QmsTemplateQuestion id' })
  @IsString()
  @MinLength(1)
  questionKey!: string;

  @ApiPropertyOptional({
    description: 'The answer, as typed/selected. Omit for an unanswered optional question.',
  })
  @IsOptional()
  @IsString()
  answer?: string;

  @ApiPropertyOptional({
    description:
      'Observation for this question. Required when the answer fails a check whose template demands evidence on failure.',
  })
  @IsOptional()
  @IsString()
  comments?: string;
}

/**
 * One line's QC decision. accepted + rejected must equal the received qty, and
 * the quantities must agree with the inspection checklist: a failed checklist
 * cannot accept the whole lot, and a passed checklist cannot reject any of it.
 */
export class QcInspectionLineDto {
  @ApiProperty() @IsString() @MinLength(1) grnLineId!: string;

  @ApiProperty({
    description:
      'APPROVED QmsQuestionTemplate of type INCOMING this line was inspected against',
  })
  @IsString()
  @MinLength(1)
  templateId!: string;

  @ApiProperty({
    type: [QcChecklistResponseDto],
    description: 'Answers to the template questions. Every required question must be answered.',
  })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => QcChecklistResponseDto)
  responses!: QcChecklistResponseDto[];

  @ApiProperty({ description: 'Quantity that passed QC and enters stock' })
  @IsNumber({ maxDecimalPlaces: 4 })
  @Min(0)
  acceptedQuantity!: number;

  @ApiProperty({ description: 'Quantity that failed QC (never enters stock)' })
  @IsNumber({ maxDecimalPlaces: 4 })
  @Min(0)
  rejectedQuantity!: number;

  @ApiPropertyOptional({ description: 'Required when rejectedQuantity > 0' })
  @IsOptional()
  @IsString()
  rejectionReason?: string;

  @ApiPropertyOptional({
    description: 'Free-text inspector remarks recorded on the inspection record',
  })
  @IsOptional()
  @IsString()
  remarks?: string;
}

/**
 * Finalize the QC gate on a PENDING_QC GRN. Every line must be decided AND
 * inspected against an approved incoming template. Accepted quantity generates a
 * STOCK_IN; rejected quantity spawns an NCR; each line's checklist is preserved
 * as a QmsInspection.
 */
export class FinalizeQcDto {
  @ApiProperty({ type: [QcInspectionLineDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => QcInspectionLineDto)
  @ArrayMinSize(1)
  lines!: QcInspectionLineDto[];
}
