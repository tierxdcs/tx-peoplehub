import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsDateString,
  IsEnum,
  IsNotEmpty,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';
import { FinanceNoteSide, FinanceNoteType, GstItcStatus } from '@prisma/client';

export class CreateTdsSectionDto {
  @ApiProperty() @IsString() @IsNotEmpty() sectionCode!: string;
  @ApiProperty() @IsString() @IsNotEmpty() description!: string;
  @ApiProperty() @Type(() => Number) @IsNumber() @Min(0) ratePercent!: number;
  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  thresholdInr?: number;
  @ApiProperty() @IsDateString() effectiveFrom!: string;
  @ApiPropertyOptional() @IsOptional() @IsDateString() effectiveTo?: string;
}

export class SetTdsSectionActiveDto {
  @ApiProperty() @IsBoolean() isActive!: boolean;
}

export class CreateAdjustmentNoteDto {
  @ApiProperty({ enum: FinanceNoteSide })
  @IsEnum(FinanceNoteSide)
  side!: FinanceNoteSide;
  @ApiProperty({ enum: FinanceNoteType })
  @IsEnum(FinanceNoteType)
  noteType!: FinanceNoteType;
  @ApiProperty() @IsDateString() noteDate!: string;
  @ApiProperty() @IsString() @IsNotEmpty() invoiceId!: string;
  @ApiProperty() @IsString() @IsNotEmpty() reason!: string;
  @ApiProperty() @Type(() => Number) @IsNumber() @Min(0) taxableAmount!: number;
  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  cgstAmount?: number;
  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  sgstAmount?: number;
  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  igstAmount?: number;
}

export class RejectComplianceDto {
  @ApiProperty() @IsString() @IsNotEmpty() comment!: string;
}

export class SetItcStatusDto {
  @ApiProperty({ enum: GstItcStatus })
  @IsEnum(GstItcStatus)
  status!: GstItcStatus;
  @ApiPropertyOptional() @IsOptional() @IsString() note?: string;
}

export class SetPaymentHoldDto {
  @ApiProperty() @IsBoolean() hold!: boolean;
  @ApiPropertyOptional() @IsOptional() @IsString() reason?: string;
}

export class PreparePeriodCloseDto {
  @ApiPropertyOptional() @IsOptional() @IsString() preparationNote?: string;
  @ApiPropertyOptional() @IsOptional() @IsObject() checklist?: Record<
    string,
    boolean
  >;
}

export class ReportRangeDto {
  @ApiProperty() @IsDateString() from!: string;
  @ApiProperty() @IsDateString() to!: string;
}
