import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsDateString,
  IsNotEmpty,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  IsIn,
  Matches,
  Min,
  ValidateNested,
} from 'class-validator';

export class Gstr2bLineDto {
  @ApiProperty() @Matches(/^[0-9]{2}[A-Z0-9]{13}$/) supplierGstin!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() supplierName?: string;
  @ApiProperty() @IsString() @IsNotEmpty() invoiceNumber!: string;
  @ApiProperty() @IsDateString() invoiceDate!: string;
  @ApiProperty() @Type(() => Number) @IsNumber() @Min(0) taxableAmount!: number;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsNumber() @Min(0) cgstAmount?: number;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsNumber() @Min(0) sgstAmount?: number;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsNumber() @Min(0) igstAmount?: number;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsNumber() @Min(0) cessAmount?: number;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() itcAvailable?: boolean;
}

export class ImportGstr2bDto {
  @ApiProperty({ example: '2026-04' }) @Matches(/^\d{4}-(0[1-9]|1[0-2])$/) taxPeriod!: string;
  @ApiProperty({ type: [Gstr2bLineDto] })
  @IsArray() @ValidateNested({ each: true }) @Type(() => Gstr2bLineDto) lines!: Gstr2bLineDto[];
}

export class FilingEvidenceDto {
  @ApiProperty() @IsString() @IsNotEmpty() acknowledgementNumber!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() providerReference?: string;
  @ApiPropertyOptional() @IsOptional() @IsDateString() filedAt?: string;
  @ApiPropertyOptional() @IsOptional() @IsObject() evidence?: Record<string, unknown>;
}

export class TdsPrepareDto {
  @ApiPropertyOptional() @IsOptional() @IsObject() challanDetails?: Record<string, unknown>;
}

export class TaxPartyProfileDto {
  @ApiProperty() @IsIn(['SUPPLIER', 'VENDOR']) partyType!: 'SUPPLIER' | 'VENDOR';
  @ApiProperty() @IsString() @IsNotEmpty() partyId!: string;
  @ApiProperty() @IsString() @IsNotEmpty() legalName!: string;
  @ApiProperty() @Matches(/^[A-Z]{5}[0-9]{4}[A-Z]$/) pan!: string;
  @ApiPropertyOptional() @IsOptional() @Matches(/^[A-Z]{4}[0-9]{5}[A-Z]$/) tan?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() lowerDeductionCertificateNo?: string;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsNumber() @Min(0) lowerDeductionRate?: number;
  @ApiPropertyOptional() @IsOptional() @IsDateString() certificateValidUntil?: string;
}

export class SetInvoiceTdsDto {
  @ApiProperty() @IsString() @IsNotEmpty() sectionCode!: string;
  @ApiProperty() @Type(() => Number) @IsNumber() @Min(0) ratePercent!: number;
  @ApiProperty() @Type(() => Number) @IsNumber() @Min(0) taxableBase!: number;
}

export class CreateTdsChallanDto {
  @ApiProperty() @Matches(/^\d{7}$/) bsrCode!: string;
  @ApiProperty() @IsString() @IsNotEmpty() challanSerialNo!: string;
  @ApiProperty() @IsDateString() depositDate!: string;
  @ApiProperty() @Matches(/^\d{4}-\d{2}$/) financialYear!: string;
  @ApiProperty() @IsString() @IsNotEmpty() sectionCode!: string;
  @ApiProperty() @Type(() => Number) @IsNumber() @Min(0) taxAmount!: number;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsNumber() @Min(0) interestAmount?: number;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsNumber() @Min(0) feeAmount?: number;
}

export class AllocateChallanDto {
  @ApiProperty() @IsString() @IsNotEmpty() tdsReturnId!: string;
  @ApiProperty() @Type(() => Number) @IsNumber() @Min(0) amount!: number;
}

export class DueDateDto {
  @ApiProperty() @IsString() @IsNotEmpty() obligation!: string;
  @ApiProperty() @IsString() @IsNotEmpty() taxPeriod!: string;
  @ApiProperty() @IsDateString() dueDate!: string;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsNumber() @Min(0) reminderDays?: number;
}

export class EvidenceUploadDto {
  @ApiProperty() @IsIn(['GST', 'TDS']) returnKind!: 'GST' | 'TDS';
  @ApiProperty() @IsString() @IsNotEmpty() returnId!: string;
  @ApiProperty() @IsString() @IsNotEmpty() evidenceType!: string;
  @ApiProperty() @IsString() @IsNotEmpty() fileName!: string;
  @ApiProperty() @IsString() @IsNotEmpty() contentType!: string;
}
