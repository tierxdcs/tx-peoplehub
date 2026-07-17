import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { VendorAuditType } from '@prisma/client';
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

// ── Vendor ─────────────────────────────────────────────────────────
export class CreateVendorDto {
  @ApiProperty()
  @IsString()
  @MinLength(1)
  companyName!: string;

  @ApiProperty()
  @IsString()
  registeredAddress!: string;

  @ApiProperty()
  @IsString()
  factoryAddress!: string;

  @ApiProperty()
  @IsString()
  yearEstablished!: string;

  @ApiProperty()
  @IsString()
  numberOfEmployees!: string;

  @ApiProperty()
  @IsString()
  annualTurnover!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  msmeUdyamCertificate?: string;

  @ApiProperty()
  @IsString()
  contactPersonName!: string;

  @ApiProperty()
  @IsString()
  contactPersonDesignation!: string;

  @ApiProperty()
  @IsString()
  contactEmail!: string;

  @ApiProperty()
  @IsString()
  contactPhone!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  website?: string;
}

// ── Invite ───────────────────────────────────────────────────────────
export class CreateInviteDto {
  @ApiPropertyOptional({
    description: 'Link lifetime in hours (default 336 = 14 days)',
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  expiresInHours?: number;

  @ApiPropertyOptional({ description: 'Optional access password' })
  @IsOptional()
  @IsString()
  @MinLength(1)
  password?: string;
}

// ── Public questionnaire (save/resume + submit) ──────────────────────
/**
 * Partial save OR final submit of questionnaire section data. Each section is
 * an opaque JSON object (the VSAQ's 18 sections); all optional so a vendor can
 * save whatever they've filled so far. `password` carries the optional invite
 * password in the BODY (never the URL).
 */
export class PublicQuestionnaireSaveDto {
  @ApiPropertyOptional() @IsOptional() @IsString() password?: string;

  @ApiPropertyOptional() @IsOptional() @IsObject() businessProfile?: object;
  @ApiPropertyOptional() @IsOptional() @IsObject() manufacturingCapability?: object;
  @ApiPropertyOptional() @IsOptional() @IsObject() equipmentDetails?: object;
  @ApiPropertyOptional() @IsOptional() @IsObject() productionCapacity?: object;
  @ApiPropertyOptional() @IsOptional() @IsObject() qualityManagement?: object;
  @ApiPropertyOptional() @IsOptional() @IsObject() engineeringCapability?: object;
  @ApiPropertyOptional() @IsOptional() @IsObject() supplyChain?: object;
  @ApiPropertyOptional() @IsOptional() @IsObject() traceability?: object;
  @ApiPropertyOptional() @IsOptional() @IsObject() logistics?: object;
  @ApiPropertyOptional() @IsOptional() @IsObject() sustainability?: object;
  @ApiPropertyOptional() @IsOptional() @IsObject() informationSecurity?: object;
  @ApiPropertyOptional() @IsOptional() @IsObject() businessContinuity?: object;
  @ApiPropertyOptional() @IsOptional() @IsObject() ehs?: object;
  @ApiPropertyOptional() @IsOptional() @IsObject() financialInformation?: object;
  @ApiPropertyOptional() @IsOptional() @IsObject() customerSupport?: object;
  @ApiPropertyOptional() @IsOptional() @IsObject() compliance?: object;
  @ApiPropertyOptional() @IsOptional() @IsObject() references?: object;
  @ApiPropertyOptional() @IsOptional() @IsObject() declaration?: object;
}

export class PublicResolveDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  password?: string;
}

/** Presign a certificate upload from the public form. */
export class PublicCertUploadUrlDto {
  @ApiPropertyOptional() @IsOptional() @IsString() password?: string;

  @ApiProperty()
  @IsString()
  @MinLength(1)
  name!: string;

  @ApiProperty()
  @IsString()
  mimeType!: string;

  @ApiProperty({ description: 'Expected size in bytes' })
  @IsInt()
  @Min(0)
  sizeBytes!: number;
}

/** Confirm a completed certificate upload (size-match, flip to recorded). */
export class PublicCertConfirmDto {
  @ApiPropertyOptional() @IsOptional() @IsString() password?: string;

  @ApiProperty()
  @IsString()
  storageKey!: string;

  @ApiProperty()
  @IsString()
  name!: string;
}

// ── Audit ────────────────────────────────────────────────────────────
export class CreateAuditDto {
  @ApiProperty({ description: 'Which questionnaire revision was audited' })
  @IsString()
  questionnaireId!: string;

  @ApiProperty({ enum: VendorAuditType })
  @IsEnum(VendorAuditType)
  auditType!: VendorAuditType;

  @ApiProperty({ description: 'ISO date' })
  @IsDateString()
  auditDate!: string;

  @ApiProperty() @IsNumber() @Min(0) @Max(20) manufacturingCapabilityScore!: number;
  @ApiProperty() @IsNumber() @Min(0) @Max(10) capacityScore!: number;
  @ApiProperty() @IsNumber() @Min(0) @Max(20) qualitySystemScore!: number;
  @ApiProperty() @IsNumber() @Min(0) @Max(10) engineeringScore!: number;
  @ApiProperty() @IsNumber() @Min(0) @Max(5) financialStabilityScore!: number;
  @ApiProperty() @IsNumber() @Min(0) @Max(10) supplyChainScore!: number;
  @ApiProperty() @IsNumber() @Min(0) @Max(10) exportReadinessScore!: number;
  @ApiProperty() @IsNumber() @Min(0) @Max(5) sustainabilityScore!: number;
  @ApiProperty() @IsNumber() @Min(0) @Max(5) ehsScore!: number;
  @ApiProperty() @IsNumber() @Min(0) @Max(5) customerReferencesScore!: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  auditNotes?: string;
}
