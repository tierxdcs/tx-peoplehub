CREATE TYPE "QmsReportType" AS ENUM ('INSPECTION', 'AUDIT');
CREATE TYPE "QmsReportStatus" AS ENUM ('AWAITING_INTERNAL_SIGNATURE', 'AWAITING_CUSTOMER_SIGNATURE', 'EXECUTED', 'SUPERSEDED');

CREATE TABLE "qms_quality_reports" (
  "id" TEXT NOT NULL, "reportNumber" TEXT NOT NULL, "revision" INTEGER NOT NULL DEFAULT 1,
  "reportType" "QmsReportType" NOT NULL,
  "status" "QmsReportStatus" NOT NULL DEFAULT 'AWAITING_INTERNAL_SIGNATURE',
  "inspectionId" TEXT, "auditId" TEXT, "title" TEXT NOT NULL, "frozenPayload" JSONB NOT NULL,
  "customerSignatureRequired" BOOLEAN NOT NULL DEFAULT false, "generatedById" TEXT NOT NULL,
  "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "internalSignerId" TEXT,
  "internalSignerNameSnapshot" TEXT, "internalSignatureTextSnapshot" TEXT,
  "internalSignatureFontSnapshot" "SignatureFont", "internalSignedAt" TIMESTAMP(3),
  "customerSignerName" TEXT, "customerSignerDesignation" TEXT, "customerOrganisation" TEXT,
  "customerSignatureText" TEXT, "customerSignatureEvidence" JSONB, "customerSignedAt" TIMESTAMP(3),
  "supersededAt" TIMESTAMP(3), "supersededById" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "qms_quality_reports_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "qms_quality_reports_reportNumber_revision_key" ON "qms_quality_reports"("reportNumber", "revision");
CREATE INDEX "qms_quality_reports_status_generatedAt_idx" ON "qms_quality_reports"("status", "generatedAt");
CREATE INDEX "qms_quality_reports_inspectionId_revision_idx" ON "qms_quality_reports"("inspectionId", "revision");
CREATE INDEX "qms_quality_reports_auditId_revision_idx" ON "qms_quality_reports"("auditId", "revision");
ALTER TABLE "qms_quality_reports" ADD CONSTRAINT "qms_quality_reports_inspectionId_fkey" FOREIGN KEY ("inspectionId") REFERENCES "qms_inspections"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "qms_quality_reports" ADD CONSTRAINT "qms_quality_reports_auditId_fkey" FOREIGN KEY ("auditId") REFERENCES "qms_audits"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "qms_quality_reports" ADD CONSTRAINT "qms_quality_reports_source_check" CHECK (("inspectionId" IS NOT NULL AND "auditId" IS NULL AND "reportType" = 'INSPECTION') OR ("inspectionId" IS NULL AND "auditId" IS NOT NULL AND "reportType" = 'AUDIT'));
