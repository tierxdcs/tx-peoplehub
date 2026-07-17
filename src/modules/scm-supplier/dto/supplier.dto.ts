import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { SupplierAuditType } from '@prisma/client';
import {
  IsDateString,
  IsEnum,
  IsInt,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  Max,
  Min,
  MinLength,
} from 'class-validator';

export class CreateSupplierDto {
  @ApiProperty() @IsString() @MinLength(1) companyName!: string;
  @ApiProperty() @IsString() registeredAddress!: string;
  @ApiProperty() @IsString() factoryAddress!: string;
  @ApiProperty() @IsString() yearEstablished!: string;
  @ApiProperty() @IsString() numberOfEmployees!: string;
  @ApiProperty() @IsString() annualTurnover!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() msmeUdyamCertificate?: string;
  @ApiProperty() @IsString() contactPersonName!: string;
  @ApiProperty() @IsString() contactPersonDesignation!: string;
  @ApiProperty() @IsString() contactEmail!: string;
  @ApiProperty() @IsString() contactPhone!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() website?: string;
}

export class CreateInviteDto {
  @ApiPropertyOptional({ description: 'Link lifetime in hours (default 336 = 14 days)' })
  @IsOptional()
  @IsInt()
  @Min(1)
  expiresInHours?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MinLength(1)
  password?: string;
}

/** Partial save or final submit of section data. All sections optional. */
export class PublicQuestionnaireSaveDto {
  @ApiPropertyOptional() @IsOptional() @IsString() password?: string;

  @ApiPropertyOptional() @IsOptional() @IsObject() materialRange?: object;
  @ApiPropertyOptional() @IsOptional() @IsObject() materialCertifications?: object;
  @ApiPropertyOptional() @IsOptional() @IsObject() compliance?: object;
  @ApiPropertyOptional() @IsOptional() @IsObject() qualityCertifications?: object;
  @ApiPropertyOptional() @IsOptional() @IsObject() commercialTerms?: object;
  @ApiPropertyOptional() @IsOptional() @IsObject() packagingAndDelivery?: object;
  @ApiPropertyOptional() @IsOptional() @IsObject() logistics?: object;
  @ApiPropertyOptional() @IsOptional() @IsObject() references?: object;
  @ApiPropertyOptional() @IsOptional() @IsObject() declaration?: object;
}

export class PublicResolveDto {
  @ApiPropertyOptional() @IsOptional() @IsString() password?: string;
}

export class PublicCertUploadUrlDto {
  @ApiPropertyOptional() @IsOptional() @IsString() password?: string;
  @ApiProperty() @IsString() @MinLength(1) name!: string;
  @ApiProperty() @IsString() mimeType!: string;
  @ApiProperty({ description: 'Expected size in bytes' }) @IsInt() @Min(0) sizeBytes!: number;
}

export class PublicCertConfirmDto {
  @ApiPropertyOptional() @IsOptional() @IsString() password?: string;
  @ApiProperty() @IsString() storageKey!: string;
  @ApiProperty() @IsString() name!: string;
}

export class CreateAuditDto {
  @ApiProperty({ description: 'Which questionnaire revision was audited' })
  @IsString()
  questionnaireId!: string;

  @ApiProperty({ enum: SupplierAuditType })
  @IsEnum(SupplierAuditType)
  auditType!: SupplierAuditType;

  @ApiProperty({ description: 'ISO date' })
  @IsDateString()
  auditDate!: string;

  @ApiProperty() @IsNumber() @Min(0) @Max(30) materialCertificationsQualityScore!: number;
  @ApiProperty() @IsNumber() @Min(0) @Max(15) complianceScore!: number;
  @ApiProperty() @IsNumber() @Min(0) @Max(20) commercialTermsScore!: number;
  @ApiProperty() @IsNumber() @Min(0) @Max(15) logisticsDeliveryScore!: number;
  @ApiProperty() @IsNumber() @Min(0) @Max(10) financialStabilityScore!: number;
  @ApiProperty() @IsNumber() @Min(0) @Max(10) referencesScore!: number;

  @ApiPropertyOptional() @IsOptional() @IsString() auditNotes?: string;
}
