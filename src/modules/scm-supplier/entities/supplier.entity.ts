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
  @ApiProperty({ enum: SupplierStatus }) status!: SupplierStatus;
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

export class SupplierQuestionnaireEntity {
  @ApiProperty() id!: string;
  @ApiProperty() supplierId!: string;
  @ApiProperty() revisionNumber!: number;
  @ApiProperty({ enum: SupplierQuestionnaireStatus })
  status!: SupplierQuestionnaireStatus;
  @ApiProperty({ nullable: true }) submittedAt!: string | null;
  @ApiProperty({ enum: SupplierFilledBy, nullable: true })
  filledBy!: SupplierFilledBy | null;

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
  @ApiProperty({ description: 'Public token — build the supplier URL from this' })
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
    enum: ['APPROVED_PREFERRED', 'APPROVED', 'CONDITIONALLY_APPROVED', 'NOT_APPROVED'],
  })
  classification!: SupplierClassification;
  @ApiProperty() classificationLabel!: string;

  @ApiProperty({ nullable: true }) auditNotes!: string | null;
  @ApiProperty() createdAt!: string;
  @ApiProperty() updatedAt!: string;

  constructor(p: Partial<SupplierAuditEntity>) {
    Object.assign(this, p);
  }
}
