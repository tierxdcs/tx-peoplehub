import { ApiProperty } from '@nestjs/swagger';
import {
  SupplierAuditType,
  SupplierFilledBy,
  SupplierQuestionnaireStatus,
  SupplierStatus,
} from '@prisma/client';
import type { SupplierClassification } from '../supplier-scoring';

export class SupplierEntity {
  @ApiProperty() id!: string;
  @ApiProperty() companyName!: string;
  @ApiProperty({ nullable: true }) registeredAddress!: string | null;
  @ApiProperty({ nullable: true }) factoryAddress!: string | null;
  @ApiProperty({ nullable: true }) yearEstablished!: string | null;
  @ApiProperty({ nullable: true }) numberOfEmployees!: string | null;
  @ApiProperty({ nullable: true }) annualTurnover!: string | null;
  @ApiProperty({ nullable: true }) msmeUdyamCertificate!: string | null;
  @ApiProperty({ nullable: true }) gstin!: string | null;
  @ApiProperty({ nullable: true }) contactPersonName!: string | null;
  @ApiProperty({ nullable: true }) contactPersonDesignation!: string | null;
  @ApiProperty() contactEmail!: string;
  @ApiProperty({ nullable: true }) contactPhone!: string | null;
  @ApiProperty({ nullable: true }) website!: string | null;
  @ApiProperty({ enum: SupplierStatus }) status!: SupplierStatus;
  @ApiProperty({
    description:
      'True when `status` came from a SuperAdmin override, not the audit score',
  })
  statusOverridden!: boolean;
  @ApiProperty() createdById!: string;
  @ApiProperty() createdAt!: string;
  @ApiProperty() updatedAt!: string;

  constructor(p: Partial<SupplierEntity>) {
    Object.assign(this, p);
  }
}

export class SupplierCertificateFileEntity {
  @ApiProperty() storageKey!: string;
  @ApiProperty() name!: string;
  @ApiProperty({ nullable: true }) sizeBytes!: number | null;
  @ApiProperty({ nullable: true }) contentType!: string | null;

  constructor(p: Partial<SupplierCertificateFileEntity>) {
    Object.assign(this, p);
  }
}

/**
 * The Supplier master fields surfaced on the public form's "Company
 * Information" section. companyName/contactEmail are read-only there
 * (staff-set at creation); everything else is editable — see
 * PublicCompanyInfoDto.
 */
export class SupplierCompanyInfoEntity {
  @ApiProperty() companyName!: string;
  @ApiProperty() contactEmail!: string;
  @ApiProperty({ nullable: true }) registeredAddress!: string | null;
  @ApiProperty({ nullable: true }) factoryAddress!: string | null;
  @ApiProperty({ nullable: true }) yearEstablished!: string | null;
  @ApiProperty({ nullable: true }) numberOfEmployees!: string | null;
  @ApiProperty({ nullable: true }) annualTurnover!: string | null;
  @ApiProperty({ nullable: true }) msmeUdyamCertificate!: string | null;
  @ApiProperty({ nullable: true }) gstin!: string | null;
  @ApiProperty({ nullable: true }) contactPersonName!: string | null;
  @ApiProperty({ nullable: true }) contactPersonDesignation!: string | null;
  @ApiProperty({ nullable: true }) contactPhone!: string | null;
  @ApiProperty({ nullable: true }) website!: string | null;

  constructor(p: Partial<SupplierCompanyInfoEntity>) {
    Object.assign(this, p);
  }
}

export class SupplierQuestionnaireEntity {
  @ApiProperty() id!: string;
  @ApiProperty() supplierId!: string;
  @ApiProperty() revisionNumber!: number;
  @ApiProperty({ enum: SupplierQuestionnaireStatus })
  status!: SupplierQuestionnaireStatus;
  @ApiProperty({ nullable: true }) submittedAt!: string | null;
  @ApiProperty({ enum: SupplierFilledBy, nullable: true })
  filledBy!: SupplierFilledBy | null;

  @ApiProperty({
    type: () => SupplierCompanyInfoEntity,
    description:
      "The Supplier record's own fields, editable via this form's Company Information section",
  })
  companyInfo!: SupplierCompanyInfoEntity;

  @ApiProperty({ nullable: true }) materialRange!: unknown;
  @ApiProperty({ nullable: true }) materialCertifications!: unknown;
  @ApiProperty({ nullable: true }) compliance!: unknown;
  @ApiProperty({ nullable: true }) qualityCertifications!: unknown;
  @ApiProperty({ nullable: true }) commercialTerms!: unknown;
  @ApiProperty({ nullable: true }) packagingAndDelivery!: unknown;
  @ApiProperty({ nullable: true }) logistics!: unknown;
  @ApiProperty({ nullable: true }) references!: unknown;
  @ApiProperty({ nullable: true }) declaration!: unknown;

  @ApiProperty({ type: [SupplierCertificateFileEntity] })
  certificateFiles!: SupplierCertificateFileEntity[];

  @ApiProperty() createdAt!: string;
  @ApiProperty() updatedAt!: string;

  constructor(p: Partial<SupplierQuestionnaireEntity>) {
    Object.assign(this, p);
  }
}

export class SupplierInviteEntity {
  @ApiProperty() id!: string;
  @ApiProperty() questionnaireId!: string;
  @ApiProperty({
    description: 'Public token — build the supplier URL from this',
  })
  token!: string;
  @ApiProperty() expiresAt!: string;
  @ApiProperty({ nullable: true }) revokedAt!: string | null;
  @ApiProperty() hasPassword!: boolean;
  @ApiProperty() createdById!: string;
  @ApiProperty() createdAt!: string;

  constructor(p: Partial<SupplierInviteEntity>) {
    Object.assign(this, p);
  }
}

export class SupplierAuditEntity {
  @ApiProperty() id!: string;
  @ApiProperty() supplierId!: string;
  @ApiProperty() questionnaireId!: string;
  @ApiProperty({ enum: SupplierAuditType }) auditType!: SupplierAuditType;
  @ApiProperty() auditDate!: string;
  @ApiProperty() auditorId!: string;
  @ApiProperty({ nullable: true }) auditorName!: string | null;

  @ApiProperty() materialCertificationsQualityScore!: string;
  @ApiProperty() complianceScore!: string;
  @ApiProperty() commercialTermsScore!: string;
  @ApiProperty() logisticsDeliveryScore!: string;
  @ApiProperty() financialStabilityScore!: string;
  @ApiProperty() referencesScore!: string;

  @ApiProperty({ description: 'Computed sum of the 6 category scores (/100)' })
  totalScore!: number;
  @ApiProperty({
    enum: [
      'APPROVED_PREFERRED',
      'APPROVED',
      'CONDITIONALLY_APPROVED',
      'NOT_APPROVED',
    ],
    description:
      'Computed from totalScore (thresholds 90/80/70) — never hidden',
  })
  classification!: SupplierClassification;
  @ApiProperty() classificationLabel!: string;

  // ── SuperAdmin classification override (null = none; use computed) ──
  @ApiProperty({
    nullable: true,
    enum: [
      'APPROVED_PREFERRED',
      'APPROVED',
      'CONDITIONALLY_APPROVED',
      'NOT_APPROVED',
    ],
    description: 'SuperAdmin-forced classification, independent of the score',
  })
  overrideClassification!: SupplierClassification | null;
  @ApiProperty({ nullable: true }) overrideClassificationLabel!: string | null;
  @ApiProperty({ nullable: true }) overrideReason!: string | null;
  @ApiProperty({ nullable: true }) overriddenById!: string | null;
  @ApiProperty({ nullable: true }) overriddenByName!: string | null;
  @ApiProperty({ nullable: true }) overriddenAt!: string | null;
  @ApiProperty({
    enum: [
      'APPROVED_PREFERRED',
      'APPROVED',
      'CONDITIONALLY_APPROVED',
      'NOT_APPROVED',
    ],
    description: 'override ?? computed — the classification actually in effect',
  })
  effectiveClassification!: SupplierClassification;
  @ApiProperty() effectiveClassificationLabel!: string;
  @ApiProperty({ description: 'Whether an override is currently in effect' })
  isOverridden!: boolean;

  @ApiProperty({ nullable: true }) auditNotes!: string | null;
  @ApiProperty() createdAt!: string;
  @ApiProperty() updatedAt!: string;

  constructor(p: Partial<SupplierAuditEntity>) {
    Object.assign(this, p);
  }
}
