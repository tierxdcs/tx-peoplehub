-- Vendor Qualification (SCM): Vendor Master + questionnaire (public token
-- invite) + weighted audit → classification. Plus the isInternalAuditor
-- designation and a new notification type. All additive.

-- Employee designation + new notification enum value
ALTER TABLE "employees" ADD COLUMN "isInternalAuditor" BOOLEAN NOT NULL DEFAULT false;
ALTER TYPE "NotificationType" ADD VALUE 'VENDOR_QUESTIONNAIRE_SUBMITTED';

-- Enums
CREATE TYPE "VendorStatus" AS ENUM ('PENDING_QUESTIONNAIRE', 'QUESTIONNAIRE_SUBMITTED', 'UNDER_AUDIT', 'APPROVED_PREFERRED', 'APPROVED', 'CONDITIONALLY_APPROVED', 'NOT_APPROVED');
CREATE TYPE "VendorQuestionnaireStatus" AS ENUM ('SENT', 'SUBMITTED');
CREATE TYPE "VendorAuditType" AS ENUM ('PHYSICAL', 'VIRTUAL');

-- Vendor (Vendor Master)
CREATE TABLE "vendors" (
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
    "status" "VendorStatus" NOT NULL DEFAULT 'PENDING_QUESTIONNAIRE',
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "vendors_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "vendors_status_idx" ON "vendors"("status");

-- VendorQuestionnaire (JSON per section)
CREATE TABLE "vendor_questionnaires" (
    "id" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "revisionNumber" INTEGER NOT NULL DEFAULT 1,
    "status" "VendorQuestionnaireStatus" NOT NULL DEFAULT 'SENT',
    "submittedAt" TIMESTAMP(3),
    "businessProfile" JSONB,
    "manufacturingCapability" JSONB,
    "equipmentDetails" JSONB,
    "productionCapacity" JSONB,
    "qualityManagement" JSONB,
    "engineeringCapability" JSONB,
    "supplyChain" JSONB,
    "traceability" JSONB,
    "logistics" JSONB,
    "sustainability" JSONB,
    "informationSecurity" JSONB,
    "businessContinuity" JSONB,
    "ehs" JSONB,
    "financialInformation" JSONB,
    "customerSupport" JSONB,
    "compliance" JSONB,
    "references" JSONB,
    "declaration" JSONB,
    "qualityCertificateFiles" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "vendor_questionnaires_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "vendor_questionnaires_vendorId_idx" ON "vendor_questionnaires"("vendorId");

-- VendorQuestionnaireInvite (public token)
CREATE TABLE "vendor_questionnaire_invites" (
    "id" TEXT NOT NULL,
    "questionnaireId" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "passwordHash" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "vendor_questionnaire_invites_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "vendor_questionnaire_invites_token_key" ON "vendor_questionnaire_invites"("token");
CREATE INDEX "vendor_questionnaire_invites_questionnaireId_idx" ON "vendor_questionnaire_invites"("questionnaireId");

-- VendorAudit (weighted scores)
CREATE TABLE "vendor_audits" (
    "id" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "questionnaireId" TEXT NOT NULL,
    "auditType" "VendorAuditType" NOT NULL,
    "auditDate" TIMESTAMP(3) NOT NULL,
    "auditorId" TEXT NOT NULL,
    "manufacturingCapabilityScore" DECIMAL(5,2) NOT NULL,
    "capacityScore" DECIMAL(5,2) NOT NULL,
    "qualitySystemScore" DECIMAL(5,2) NOT NULL,
    "engineeringScore" DECIMAL(5,2) NOT NULL,
    "financialStabilityScore" DECIMAL(5,2) NOT NULL,
    "supplyChainScore" DECIMAL(5,2) NOT NULL,
    "exportReadinessScore" DECIMAL(5,2) NOT NULL,
    "sustainabilityScore" DECIMAL(5,2) NOT NULL,
    "ehsScore" DECIMAL(5,2) NOT NULL,
    "customerReferencesScore" DECIMAL(5,2) NOT NULL,
    "auditNotes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "vendor_audits_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "vendor_audits_vendorId_idx" ON "vendor_audits"("vendorId");
CREATE INDEX "vendor_audits_questionnaireId_idx" ON "vendor_audits"("questionnaireId");

-- FKs
ALTER TABLE "vendors" ADD CONSTRAINT "vendors_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "vendor_questionnaires" ADD CONSTRAINT "vendor_questionnaires_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "vendors"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "vendor_questionnaire_invites" ADD CONSTRAINT "vendor_questionnaire_invites_questionnaireId_fkey" FOREIGN KEY ("questionnaireId") REFERENCES "vendor_questionnaires"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "vendor_questionnaire_invites" ADD CONSTRAINT "vendor_questionnaire_invites_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "vendor_audits" ADD CONSTRAINT "vendor_audits_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "vendors"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "vendor_audits" ADD CONSTRAINT "vendor_audits_questionnaireId_fkey" FOREIGN KEY ("questionnaireId") REFERENCES "vendor_questionnaires"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "vendor_audits" ADD CONSTRAINT "vendor_audits_auditorId_fkey" FOREIGN KEY ("auditorId") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
