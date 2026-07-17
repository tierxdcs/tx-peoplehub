-- Supplier Qualification (SCM raw materials) — distinct from Vendor
-- Qualification. Adds Supplier master + questionnaire (public token invite) +
-- 6-category weighted audit, a new notification type, and relatedSupplierId.

ALTER TYPE "NotificationType" ADD VALUE 'SUPPLIER_QUESTIONNAIRE_SUBMITTED';

CREATE TYPE "SupplierStatus" AS ENUM ('PENDING_QUESTIONNAIRE', 'QUESTIONNAIRE_SUBMITTED', 'UNDER_AUDIT', 'APPROVED_PREFERRED', 'APPROVED', 'CONDITIONALLY_APPROVED', 'NOT_APPROVED');
CREATE TYPE "SupplierQuestionnaireStatus" AS ENUM ('SENT', 'SUBMITTED');
CREATE TYPE "SupplierAuditType" AS ENUM ('PHYSICAL', 'VIRTUAL');

CREATE TABLE "suppliers" (
    "id" TEXT NOT NULL,
    "companyName" TEXT NOT NULL,
    "registeredAddress" TEXT NOT NULL,
    "factoryAddress" TEXT NOT NULL,
    "yearEstablished" TEXT NOT NULL,
    "numberOfEmployees" TEXT NOT NULL,
    "annualTurnover" TEXT NOT NULL,
    "msmeUdyamCertificate" TEXT,
    "contactPersonName" TEXT NOT NULL,
    "contactPersonDesignation" TEXT NOT NULL,
    "contactEmail" TEXT NOT NULL,
    "contactPhone" TEXT NOT NULL,
    "website" TEXT,
    "status" "SupplierStatus" NOT NULL DEFAULT 'PENDING_QUESTIONNAIRE',
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "suppliers_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "suppliers_status_idx" ON "suppliers"("status");

CREATE TABLE "supplier_questionnaires" (
    "id" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "revisionNumber" INTEGER NOT NULL DEFAULT 1,
    "status" "SupplierQuestionnaireStatus" NOT NULL DEFAULT 'SENT',
    "submittedAt" TIMESTAMP(3),
    "materialRange" JSONB,
    "materialCertifications" JSONB,
    "compliance" JSONB,
    "qualityCertifications" JSONB,
    "commercialTerms" JSONB,
    "packagingAndDelivery" JSONB,
    "logistics" JSONB,
    "references" JSONB,
    "declaration" JSONB,
    "certificateFiles" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "supplier_questionnaires_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "supplier_questionnaires_supplierId_idx" ON "supplier_questionnaires"("supplierId");

CREATE TABLE "supplier_questionnaire_invites" (
    "id" TEXT NOT NULL,
    "questionnaireId" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "passwordHash" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "supplier_questionnaire_invites_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "supplier_questionnaire_invites_token_key" ON "supplier_questionnaire_invites"("token");
CREATE INDEX "supplier_questionnaire_invites_questionnaireId_idx" ON "supplier_questionnaire_invites"("questionnaireId");

CREATE TABLE "supplier_audits" (
    "id" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "questionnaireId" TEXT NOT NULL,
    "auditType" "SupplierAuditType" NOT NULL,
    "auditDate" TIMESTAMP(3) NOT NULL,
    "auditorId" TEXT NOT NULL,
    "materialCertificationsQualityScore" DECIMAL(5,2) NOT NULL,
    "complianceScore" DECIMAL(5,2) NOT NULL,
    "commercialTermsScore" DECIMAL(5,2) NOT NULL,
    "logisticsDeliveryScore" DECIMAL(5,2) NOT NULL,
    "financialStabilityScore" DECIMAL(5,2) NOT NULL,
    "referencesScore" DECIMAL(5,2) NOT NULL,
    "auditNotes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "supplier_audits_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "supplier_audits_supplierId_idx" ON "supplier_audits"("supplierId");
CREATE INDEX "supplier_audits_questionnaireId_idx" ON "supplier_audits"("questionnaireId");

ALTER TABLE "notifications" ADD COLUMN "relatedSupplierId" TEXT;

ALTER TABLE "suppliers" ADD CONSTRAINT "suppliers_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "supplier_questionnaires" ADD CONSTRAINT "supplier_questionnaires_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "suppliers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "supplier_questionnaire_invites" ADD CONSTRAINT "supplier_questionnaire_invites_questionnaireId_fkey" FOREIGN KEY ("questionnaireId") REFERENCES "supplier_questionnaires"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "supplier_questionnaire_invites" ADD CONSTRAINT "supplier_questionnaire_invites_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "supplier_audits" ADD CONSTRAINT "supplier_audits_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "suppliers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "supplier_audits" ADD CONSTRAINT "supplier_audits_questionnaireId_fkey" FOREIGN KEY ("questionnaireId") REFERENCES "supplier_questionnaires"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "supplier_audits" ADD CONSTRAINT "supplier_audits_auditorId_fkey" FOREIGN KEY ("auditorId") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_relatedSupplierId_fkey" FOREIGN KEY ("relatedSupplierId") REFERENCES "suppliers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
