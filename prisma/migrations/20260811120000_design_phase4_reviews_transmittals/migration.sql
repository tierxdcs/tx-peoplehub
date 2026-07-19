CREATE TYPE "DesignReviewType" AS ENUM ('REQUIREMENTS_REVIEW','CONCEPT_REVIEW','PRELIMINARY_DESIGN_REVIEW','CRITICAL_DESIGN_REVIEW','MANUFACTURING_READINESS_REVIEW','CHANGE_REVIEW','FINAL_DESIGN_REVIEW');
CREATE TYPE "DesignReviewStatus" AS ENUM ('SCHEDULED','IN_PROGRESS','PENDING_CLOSURE','CLOSED','CANCELLED');
CREATE TYPE "DesignReviewActionStatus" AS ENUM ('OPEN','IN_PROGRESS','COMPLETED','VERIFIED','CANCELLED');
CREATE TYPE "DesignTemplateStatus" AS ENUM ('DRAFT','APPROVED','RETIRED');
CREATE TYPE "DesignTransmittalStatus" AS ENUM ('DRAFT','ISSUED','ACKNOWLEDGED','SUPERSEDED');
CREATE TYPE "DesignChangeReportStatus" AS ENUM ('AWAITING_INTERNAL_SIGNATURE','AWAITING_CUSTOMER_SIGNATURE','EXECUTED','SUPERSEDED');

CREATE TABLE "design_reviews" (
 "id" TEXT NOT NULL, "reviewNumber" TEXT NOT NULL, "projectId" TEXT NOT NULL, "changeId" TEXT,
 "reviewType" "DesignReviewType" NOT NULL, "title" TEXT NOT NULL, "objectives" TEXT NOT NULL,
 "scheduledAt" TIMESTAMP(3) NOT NULL, "locationOrLink" TEXT, "chairpersonId" TEXT NOT NULL,
 "status" "DesignReviewStatus" NOT NULL DEFAULT 'SCHEDULED', "minutes" TEXT, "decision" TEXT,
 "createdById" TEXT NOT NULL, "closedById" TEXT, "closedAt" TIMESTAMP(3),
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
 CONSTRAINT "design_reviews_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "design_review_attendees" (
 "id" TEXT NOT NULL, "reviewId" TEXT NOT NULL, "employeeId" TEXT, "name" TEXT NOT NULL,
 "functionName" TEXT, "external" BOOLEAN NOT NULL DEFAULT false, "attended" BOOLEAN NOT NULL DEFAULT false,
 "comments" TEXT, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT "design_review_attendees_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "design_review_actions" (
 "id" TEXT NOT NULL, "reviewId" TEXT NOT NULL, "actionNumber" INTEGER NOT NULL, "description" TEXT NOT NULL,
 "ownerId" TEXT NOT NULL, "dueDate" TIMESTAMP(3) NOT NULL, "status" "DesignReviewActionStatus" NOT NULL DEFAULT 'OPEN',
 "completionNote" TEXT, "completedById" TEXT, "completedAt" TIMESTAMP(3), "verifiedById" TEXT, "verifiedAt" TIMESTAMP(3),
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
 CONSTRAINT "design_review_actions_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "design_project_templates" (
 "id" TEXT NOT NULL, "templateCode" TEXT NOT NULL, "name" TEXT NOT NULL, "description" TEXT,
 "version" INTEGER NOT NULL DEFAULT 1, "status" "DesignTemplateStatus" NOT NULL DEFAULT 'DRAFT',
 "requirements" JSONB NOT NULL, "milestones" JSONB NOT NULL, "createdById" TEXT NOT NULL,
 "approvedById" TEXT, "approvedAt" TIMESTAMP(3), "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "updatedAt" TIMESTAMP(3) NOT NULL, CONSTRAINT "design_project_templates_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "design_transmittals" (
 "id" TEXT NOT NULL, "transmittalNumber" TEXT NOT NULL, "projectId" TEXT NOT NULL, "purpose" TEXT NOT NULL,
 "recipientOrganisation" TEXT NOT NULL, "recipientName" TEXT NOT NULL, "recipientEmail" TEXT, "message" TEXT,
 "status" "DesignTransmittalStatus" NOT NULL DEFAULT 'DRAFT', "createdById" TEXT NOT NULL,
 "issuedById" TEXT, "issuedAt" TIMESTAMP(3), "issuerNameSnapshot" TEXT, "signatureTextSnapshot" TEXT,
 "signatureFontSnapshot" "SignatureFont", "acknowledgedByName" TEXT, "acknowledgementNote" TEXT,
 "acknowledgedAt" TIMESTAMP(3), "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "updatedAt" TIMESTAMP(3) NOT NULL, CONSTRAINT "design_transmittals_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "design_transmittal_items" (
 "id" TEXT NOT NULL, "transmittalId" TEXT NOT NULL, "revisionId" TEXT NOT NULL,
 "documentNumberSnapshot" TEXT NOT NULL, "titleSnapshot" TEXT NOT NULL, "revisionCodeSnapshot" TEXT NOT NULL,
 "purpose" TEXT, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT "design_transmittal_items_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "design_change_reports" (
 "id" TEXT NOT NULL, "reportNumber" TEXT NOT NULL, "revision" INTEGER NOT NULL DEFAULT 1, "changeId" TEXT NOT NULL,
 "title" TEXT NOT NULL, "status" "DesignChangeReportStatus" NOT NULL DEFAULT 'AWAITING_INTERNAL_SIGNATURE',
 "frozenPayload" JSONB NOT NULL, "customerSignatureRequired" BOOLEAN NOT NULL DEFAULT false,
 "generatedById" TEXT NOT NULL, "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "internalSignerId" TEXT, "internalSignerNameSnapshot" TEXT, "internalSignatureTextSnapshot" TEXT,
 "internalSignatureFontSnapshot" "SignatureFont", "internalSignedAt" TIMESTAMP(3), "customerSignerName" TEXT,
 "customerSignerDesignation" TEXT, "customerOrganisation" TEXT, "customerSignatureText" TEXT,
 "customerSignatureEvidence" JSONB, "customerSignedAt" TIMESTAMP(3), "supersededAt" TIMESTAMP(3),
 "supersededById" TEXT, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
 CONSTRAINT "design_change_reports_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "design_reviews_reviewNumber_key" ON "design_reviews"("reviewNumber");
CREATE INDEX "design_reviews_projectId_status_scheduledAt_idx" ON "design_reviews"("projectId","status","scheduledAt");
CREATE INDEX "design_reviews_changeId_idx" ON "design_reviews"("changeId");
CREATE INDEX "design_review_attendees_reviewId_attended_idx" ON "design_review_attendees"("reviewId","attended");
CREATE UNIQUE INDEX "design_review_actions_reviewId_actionNumber_key" ON "design_review_actions"("reviewId","actionNumber");
CREATE INDEX "design_review_actions_ownerId_status_dueDate_idx" ON "design_review_actions"("ownerId","status","dueDate");
CREATE UNIQUE INDEX "design_project_templates_templateCode_key" ON "design_project_templates"("templateCode");
CREATE INDEX "design_project_templates_status_name_idx" ON "design_project_templates"("status","name");
CREATE UNIQUE INDEX "design_transmittals_transmittalNumber_key" ON "design_transmittals"("transmittalNumber");
CREATE INDEX "design_transmittals_projectId_status_idx" ON "design_transmittals"("projectId","status");
CREATE INDEX "design_transmittals_status_issuedAt_idx" ON "design_transmittals"("status","issuedAt");
CREATE UNIQUE INDEX "design_transmittal_items_transmittalId_revisionId_key" ON "design_transmittal_items"("transmittalId","revisionId");
CREATE INDEX "design_transmittal_items_revisionId_idx" ON "design_transmittal_items"("revisionId");
CREATE UNIQUE INDEX "design_change_reports_reportNumber_revision_key" ON "design_change_reports"("reportNumber","revision");
CREATE INDEX "design_change_reports_changeId_revision_idx" ON "design_change_reports"("changeId","revision");
CREATE INDEX "design_change_reports_status_generatedAt_idx" ON "design_change_reports"("status","generatedAt");

ALTER TABLE "design_reviews" ADD CONSTRAINT "design_reviews_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "design_projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "design_review_attendees" ADD CONSTRAINT "design_review_attendees_reviewId_fkey" FOREIGN KEY ("reviewId") REFERENCES "design_reviews"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "design_review_actions" ADD CONSTRAINT "design_review_actions_reviewId_fkey" FOREIGN KEY ("reviewId") REFERENCES "design_reviews"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "design_transmittals" ADD CONSTRAINT "design_transmittals_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "design_projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "design_transmittal_items" ADD CONSTRAINT "design_transmittal_items_transmittalId_fkey" FOREIGN KEY ("transmittalId") REFERENCES "design_transmittals"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "design_transmittal_items" ADD CONSTRAINT "design_transmittal_items_revisionId_fkey" FOREIGN KEY ("revisionId") REFERENCES "design_document_revisions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "design_change_reports" ADD CONSTRAINT "design_change_reports_changeId_fkey" FOREIGN KEY ("changeId") REFERENCES "design_changes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
