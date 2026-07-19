CREATE TYPE "QmsAuditProgramStatus" AS ENUM ('DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'RETIRED');
CREATE TYPE "QmsAuditStatus" AS ENUM ('SCHEDULED', 'IN_PROGRESS', 'PENDING_REVIEW', 'CLOSED', 'CANCELLED');
CREATE TYPE "QmsAuditFindingType" AS ENUM ('CONFORMITY', 'OBSERVATION', 'OPPORTUNITY_FOR_IMPROVEMENT', 'MINOR_NONCONFORMITY', 'MAJOR_NONCONFORMITY');

CREATE TABLE "qms_audit_programs" (
  "id" TEXT NOT NULL, "programNumber" TEXT NOT NULL, "name" TEXT NOT NULL,
  "description" TEXT, "financialYear" TEXT NOT NULL,
  "status" "QmsAuditProgramStatus" NOT NULL DEFAULT 'DRAFT',
  "createdById" TEXT NOT NULL, "submittedById" TEXT, "submittedAt" TIMESTAMP(3),
  "approvedById" TEXT, "approvedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "qms_audit_programs_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "qms_audit_programs_programNumber_key" ON "qms_audit_programs"("programNumber");
CREATE INDEX "qms_audit_programs_financialYear_status_idx" ON "qms_audit_programs"("financialYear", "status");

CREATE TABLE "qms_audit_program_items" (
  "id" TEXT NOT NULL, "programId" TEXT NOT NULL, "title" TEXT NOT NULL,
  "auditType" "QmsTemplateType" NOT NULL, "scope" TEXT NOT NULL, "criteria" TEXT NOT NULL,
  "plannedFrom" TIMESTAMP(3) NOT NULL, "plannedTo" TIMESTAMP(3) NOT NULL,
  "department" TEXT, "supplierId" TEXT, "leadAuditorId" TEXT NOT NULL, "auditeeId" TEXT,
  "templateId" TEXT NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL, CONSTRAINT "qms_audit_program_items_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "qms_audit_program_items_programId_plannedFrom_idx" ON "qms_audit_program_items"("programId", "plannedFrom");
CREATE INDEX "qms_audit_program_items_leadAuditorId_plannedFrom_idx" ON "qms_audit_program_items"("leadAuditorId", "plannedFrom");

CREATE TABLE "qms_audits" (
  "id" TEXT NOT NULL, "auditNumber" TEXT NOT NULL, "programId" TEXT, "programItemId" TEXT,
  "title" TEXT NOT NULL, "auditType" "QmsTemplateType" NOT NULL, "scope" TEXT NOT NULL,
  "criteria" TEXT NOT NULL, "scheduledFrom" TIMESTAMP(3) NOT NULL, "scheduledTo" TIMESTAMP(3) NOT NULL,
  "department" TEXT, "supplierId" TEXT, "leadAuditorId" TEXT NOT NULL, "auditeeId" TEXT,
  "status" "QmsAuditStatus" NOT NULL DEFAULT 'SCHEDULED', "templateSnapshot" JSONB NOT NULL,
  "openingNotes" TEXT, "conclusion" TEXT, "startedAt" TIMESTAMP(3), "completedAt" TIMESTAMP(3),
  "reviewedById" TEXT, "reviewedAt" TIMESTAMP(3), "createdById" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "qms_audits_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "qms_audits_auditNumber_key" ON "qms_audits"("auditNumber");
CREATE INDEX "qms_audits_status_scheduledFrom_idx" ON "qms_audits"("status", "scheduledFrom");
CREATE INDEX "qms_audits_leadAuditorId_status_idx" ON "qms_audits"("leadAuditorId", "status");
CREATE INDEX "qms_audits_auditeeId_status_idx" ON "qms_audits"("auditeeId", "status");

CREATE TABLE "qms_audit_responses" (
  "id" TEXT NOT NULL, "auditId" TEXT NOT NULL, "questionKey" TEXT NOT NULL,
  "section" TEXT NOT NULL, "sequence" INTEGER NOT NULL, "promptSnapshot" TEXT NOT NULL,
  "responseType" "QmsResponseType" NOT NULL, "required" BOOLEAN NOT NULL,
  "answer" JSONB, "result" "QmsInspectionResult", "comments" TEXT, "evidence" JSONB,
  CONSTRAINT "qms_audit_responses_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "qms_audit_responses_auditId_questionKey_key" ON "qms_audit_responses"("auditId", "questionKey");

CREATE TABLE "qms_audit_findings" (
  "id" TEXT NOT NULL, "auditId" TEXT NOT NULL, "findingType" "QmsAuditFindingType" NOT NULL,
  "clause" TEXT, "description" TEXT NOT NULL, "evidence" TEXT, "ownerId" TEXT,
  "targetDate" TIMESTAMP(3), "ncrId" TEXT, "createdById" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "qms_audit_findings_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "qms_audit_findings_ncrId_key" ON "qms_audit_findings"("ncrId");
CREATE INDEX "qms_audit_findings_auditId_findingType_idx" ON "qms_audit_findings"("auditId", "findingType");

ALTER TABLE "qms_audit_program_items" ADD CONSTRAINT "qms_audit_program_items_programId_fkey" FOREIGN KEY ("programId") REFERENCES "qms_audit_programs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "qms_audit_program_items" ADD CONSTRAINT "qms_audit_program_items_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "qms_question_templates"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "qms_audits" ADD CONSTRAINT "qms_audits_programId_fkey" FOREIGN KEY ("programId") REFERENCES "qms_audit_programs"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "qms_audits" ADD CONSTRAINT "qms_audits_programItemId_fkey" FOREIGN KEY ("programItemId") REFERENCES "qms_audit_program_items"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "qms_audit_responses" ADD CONSTRAINT "qms_audit_responses_auditId_fkey" FOREIGN KEY ("auditId") REFERENCES "qms_audits"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "qms_audit_findings" ADD CONSTRAINT "qms_audit_findings_auditId_fkey" FOREIGN KEY ("auditId") REFERENCES "qms_audits"("id") ON DELETE CASCADE ON UPDATE CASCADE;
