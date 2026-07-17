import { ApiProperty } from '@nestjs/swagger';
import {
  VendorAuditType,
  VendorQuestionnaireStatus,
  VendorStatus,
} from '@prisma/client';
import type { VendorClassification } from '../vendor-scoring';

export class VendorEntity {
  @ApiProperty() id!: string;
  @ApiProperty() companyName!: string;
  @ApiProperty() registeredAddress!: string;
  @ApiProperty() factoryAddress!: string;
  @ApiProperty() yearEstablished!: string;
  @ApiProperty() numberOfEmployees!: string;
  @ApiProperty() annualTurnover!: string;
  @ApiProperty({ nullable: true }) msmeUdyamCertificate!: string | null;
  @ApiProperty() contactPersonName!: string;
  @ApiProperty() contactPersonDesignation!: string;
  @ApiProperty() contactEmail!: string;
  @ApiProperty() contactPhone!: string;
  @ApiProperty({ nullable: true }) website!: string | null;
  @ApiProperty({ enum: VendorStatus }) status!: VendorStatus;
  @ApiProperty() createdById!: string;
  @ApiProperty() createdAt!: string;
  @ApiProperty() updatedAt!: string;

  constructor(p: Partial<VendorEntity>) {
    Object.assign(this, p);
  }
}

export class VendorCertificateFileEntity {
  @ApiProperty() storageKey!: string;
  @ApiProperty() name!: string;
  @ApiProperty({ nullable: true }) sizeBytes!: number | null;
  @ApiProperty({ nullable: true }) contentType!: string | null;

  constructor(p: Partial<VendorCertificateFileEntity>) {
    Object.assign(this, p);
  }
}

export class VendorQuestionnaireEntity {
  @ApiProperty() id!: string;
  @ApiProperty() vendorId!: string;
  @ApiProperty() revisionNumber!: number;
  @ApiProperty({ enum: VendorQuestionnaireStatus })
  status!: VendorQuestionnaireStatus;
  @ApiProperty({ nullable: true }) submittedAt!: string | null;

  // The 18 VSAQ sections — opaque JSON blobs (null until filled).
  @ApiProperty({ nullable: true }) businessProfile!: unknown;
  @ApiProperty({ nullable: true }) manufacturingCapability!: unknown;
  @ApiProperty({ nullable: true }) equipmentDetails!: unknown;
  @ApiProperty({ nullable: true }) productionCapacity!: unknown;
  @ApiProperty({ nullable: true }) qualityManagement!: unknown;
  @ApiProperty({ nullable: true }) engineeringCapability!: unknown;
  @ApiProperty({ nullable: true }) supplyChain!: unknown;
  @ApiProperty({ nullable: true }) traceability!: unknown;
  @ApiProperty({ nullable: true }) logistics!: unknown;
  @ApiProperty({ nullable: true }) sustainability!: unknown;
  @ApiProperty({ nullable: true }) informationSecurity!: unknown;
  @ApiProperty({ nullable: true }) businessContinuity!: unknown;
  @ApiProperty({ nullable: true }) ehs!: unknown;
  @ApiProperty({ nullable: true }) financialInformation!: unknown;
  @ApiProperty({ nullable: true }) customerSupport!: unknown;
  @ApiProperty({ nullable: true }) compliance!: unknown;
  @ApiProperty({ nullable: true }) references!: unknown;
  @ApiProperty({ nullable: true }) declaration!: unknown;

  @ApiProperty({ type: [VendorCertificateFileEntity] })
  qualityCertificateFiles!: VendorCertificateFileEntity[];

  @ApiProperty() createdAt!: string;
  @ApiProperty() updatedAt!: string;

  constructor(p: Partial<VendorQuestionnaireEntity>) {
    Object.assign(this, p);
  }
}

export class VendorInviteEntity {
  @ApiProperty() id!: string;
  @ApiProperty() questionnaireId!: string;
  @ApiProperty({ description: 'The public token — build the vendor URL from this' })
  token!: string;
  @ApiProperty() expiresAt!: string;
  @ApiProperty({ nullable: true }) revokedAt!: string | null;
  @ApiProperty({ description: 'Whether a password is required to open the link' })
  hasPassword!: boolean;
  @ApiProperty() createdById!: string;
  @ApiProperty() createdAt!: string;

  constructor(p: Partial<VendorInviteEntity>) {
    Object.assign(this, p);
  }
}

export class VendorAuditEntity {
  @ApiProperty() id!: string;
  @ApiProperty() vendorId!: string;
  @ApiProperty() questionnaireId!: string;
  @ApiProperty({ enum: VendorAuditType }) auditType!: VendorAuditType;
  @ApiProperty() auditDate!: string;
  @ApiProperty() auditorId!: string;
  @ApiProperty({ nullable: true }) auditorName!: string | null;

  @ApiProperty() manufacturingCapabilityScore!: string;
  @ApiProperty() capacityScore!: string;
  @ApiProperty() qualitySystemScore!: string;
  @ApiProperty() engineeringScore!: string;
  @ApiProperty() financialStabilityScore!: string;
  @ApiProperty() supplyChainScore!: string;
  @ApiProperty() exportReadinessScore!: string;
  @ApiProperty() sustainabilityScore!: string;
  @ApiProperty() ehsScore!: string;
  @ApiProperty() customerReferencesScore!: string;

  @ApiProperty({ description: 'Computed sum of the 10 category scores (/100)' })
  totalScore!: number;
  @ApiProperty({
    enum: ['APPROVED_PREFERRED', 'APPROVED', 'CONDITIONALLY_APPROVED', 'NOT_APPROVED'],
    description: 'Computed from totalScore (thresholds 90/80/70)',
  })
  classification!: VendorClassification;
  @ApiProperty() classificationLabel!: string;

  @ApiProperty({ nullable: true }) auditNotes!: string | null;
  @ApiProperty() createdAt!: string;
  @ApiProperty() updatedAt!: string;

  constructor(p: Partial<VendorAuditEntity>) {
    Object.assign(this, p);
  }
}
