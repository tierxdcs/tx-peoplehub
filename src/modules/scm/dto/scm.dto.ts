import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
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
  ValidateNested,
} from 'class-validator';

// ── Vendor ─────────────────────────────────────────────────────────
/**
 * Only companyName + contactEmail are required at creation — staff often don't
 * know the rest yet, and it's expected to arrive via the vendor's own
 * questionnaire (see the public "Company Information" section). Everything
 * else here is optional but still settable by staff if they DO know it.
 */
export class CreateVendorDto {
  @ApiProperty()
  @IsString()
  @MinLength(1)
  companyName!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  registeredAddress?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  factoryAddress?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  yearEstablished?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  numberOfEmployees?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  annualTurnover?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  msmeUdyamCertificate?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  contactPersonName?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  contactPersonDesignation?: string;

  @ApiProperty()
  @IsString()
  @MinLength(1)
  contactEmail!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  contactPhone?: string;

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

/**
 * The Vendor master fields the vendor themselves may complete/correct via the
 * public form's "Company Information" section — exactly the fields Part 1
 * relaxed to optional at creation (NOT companyName/contactEmail, which stay
 * staff-set: companyName is the reconciliation key, contactEmail identifies
 * who the invite was sent to). All optional so a partial save doesn't force
 * every field at once.
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

// ── Public questionnaire (save/resume + submit) ──────────────────────
/**
 * Partial save OR final submit of questionnaire section data. Each section is
 * an opaque JSON object (the VSAQ's 18 sections); all optional so a vendor can
 * save whatever they've filled so far. `password` carries the optional invite
 * password in the BODY (never the URL). `companyInfo` is NOT a section — it
 * writes back to the Vendor master record itself (see savePublic/submitPublic).
 */
export class PublicQuestionnaireSaveDto {
  @ApiPropertyOptional() @IsOptional() @IsString() password?: string;

  @ApiPropertyOptional({ type: () => PublicCompanyInfoDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => PublicCompanyInfoDto)
  companyInfo?: PublicCompanyInfoDto;

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
