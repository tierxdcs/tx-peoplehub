import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
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
  ValidateNested,
} from 'class-validator';

/**
 * Only companyName + contactEmail are required at creation — staff often don't
 * know the rest yet, and it's expected to arrive via the supplier's own
 * questionnaire (see the public "Company Information" section). Everything
 * else here is optional but still settable by staff if they DO know it.
 */
export class CreateSupplierDto {
  @ApiProperty() @IsString() @MinLength(1) companyName!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() registeredAddress?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() factoryAddress?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() yearEstablished?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() numberOfEmployees?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() annualTurnover?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() msmeUdyamCertificate?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() contactPersonName?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() contactPersonDesignation?: string;
  @ApiProperty() @IsString() @MinLength(1) contactEmail!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() contactPhone?: string;
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

/**
 * The Supplier master fields the supplier themselves may complete/correct via
 * the public form's "Company Information" section — exactly the fields Part 1
 * relaxed to optional at creation (NOT companyName/contactEmail, which stay
 * staff-set). All optional so a partial save doesn't force every field at once.
 */
export class PublicCompanyInfoDto {
  @ApiPropertyOptional() @IsOptional() @IsString() registeredAddress?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() factoryAddress?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() yearEstablished?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() numberOfEmployees?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() annualTurnover?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() msmeUdyamCertificate?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() contactPersonName?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() contactPersonDesignation?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() contactPhone?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() website?: string;
}

/**
 * Partial save or final submit of section data. All sections optional.
 * `companyInfo` is NOT a section — it writes back to the Supplier master
 * record itself (see savePublic/submitPublic/saveInternal/submitInternal).
 */
export class PublicQuestionnaireSaveDto {
  @ApiPropertyOptional() @IsOptional() @IsString() password?: string;

  @ApiPropertyOptional({ type: () => PublicCompanyInfoDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => PublicCompanyInfoDto)
  companyInfo?: PublicCompanyInfoDto;

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
