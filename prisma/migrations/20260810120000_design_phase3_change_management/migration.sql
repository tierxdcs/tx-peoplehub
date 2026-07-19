CREATE TYPE "DesignChangeType" AS ENUM ('CORRECTION', 'CUSTOMER_REQUEST', 'VALUE_ENGINEERING', 'COST_REDUCTION', 'OBSOLESCENCE', 'REGULATORY', 'PROCESS_IMPROVEMENT', 'OTHER');
CREATE TYPE "DesignChangeStatus" AS ENUM ('DRAFT', 'IMPACT_ASSESSMENT', 'PENDING_APPROVAL', 'APPROVED', 'IMPLEMENTING', 'CLOSED', 'REJECTED');
CREATE TYPE "DesignChangeImpactArea" AS ENUM ('DESIGN', 'BOM', 'INVENTORY', 'WORK_IN_PROGRESS', 'PROCUREMENT', 'PRODUCTION', 'QUALITY', 'COST', 'SCHEDULE', 'CUSTOMER');
CREATE TYPE "DesignChangeImpactStatus" AS ENUM ('PENDING', 'COMPLETED');
CREATE TYPE "DesignChangeObjectType" AS ENUM ('DOCUMENT_REVISION', 'BOM', 'ITEM', 'INVENTORY', 'WORK_IN_PROGRESS', 'PURCHASE_ORDER', 'SALES_ORDER', 'OTHER');
CREATE TYPE "DesignChangeDisposition" AS ENUM ('PENDING', 'USE_AS_IS', 'REWORK', 'SCRAP', 'RETURN_TO_VENDOR', 'HOLD', 'NOT_APPLICABLE');
CREATE TYPE "DesignChangeEffectivityType" AS ENUM ('IMMEDIATE', 'NEXT_PRODUCTION_RUN', 'DATE', 'SERIAL_NUMBER', 'LOT_NUMBER');
CREATE TYPE "DesignChangeAcknowledgementStatus" AS ENUM ('PENDING', 'ACKNOWLEDGED');

CREATE TABLE "design_changes" (
  "id" TEXT NOT NULL,
  "changeNumber" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "type" "DesignChangeType" NOT NULL,
  "priority" "DesignPriority" NOT NULL DEFAULT 'MEDIUM',
  "reason" TEXT NOT NULL,
  "proposedChange" TEXT NOT NULL,
  "status" "DesignChangeStatus" NOT NULL DEFAULT 'DRAFT',
  "requestedById" TEXT NOT NULL,
  "coordinatorId" TEXT NOT NULL,
  "targetDate" TIMESTAMP(3) NOT NULL,
  "submittedAt" TIMESTAMP(3),
  "approvedById" TEXT,
  "approvedAt" TIMESTAMP(3),
  "approverNameSnapshot" TEXT,
  "signatureTextSnapshot" TEXT,
  "signatureFontSnapshot" "SignatureFont",
  "rejectionReason" TEXT,
  "implementationNote" TEXT,
  "closedById" TEXT,
  "closedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "design_changes_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "design_change_impacts" (
  "id" TEXT NOT NULL,
  "changeId" TEXT NOT NULL,
  "area" "DesignChangeImpactArea" NOT NULL,
  "ownerId" TEXT NOT NULL,
  "status" "DesignChangeImpactStatus" NOT NULL DEFAULT 'PENDING',
  "hasImpact" BOOLEAN,
  "assessment" TEXT,
  "requiredAction" TEXT,
  "assessedById" TEXT,
  "assessedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "design_change_impacts_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "design_change_affected_items" (
  "id" TEXT NOT NULL,
  "changeId" TEXT NOT NULL,
  "objectType" "DesignChangeObjectType" NOT NULL,
  "objectId" TEXT,
  "reference" TEXT NOT NULL,
  "description" TEXT,
  "currentRevision" TEXT,
  "proposedRevision" TEXT,
  "disposition" "DesignChangeDisposition" NOT NULL DEFAULT 'PENDING',
  "dispositionNote" TEXT,
  "effectivityType" "DesignChangeEffectivityType" NOT NULL,
  "effectivityValue" TEXT,
  "createdById" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "design_change_affected_items_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "design_change_acknowledgements" (
  "id" TEXT NOT NULL,
  "changeId" TEXT NOT NULL,
  "functionName" TEXT NOT NULL,
  "ownerId" TEXT NOT NULL,
  "status" "DesignChangeAcknowledgementStatus" NOT NULL DEFAULT 'PENDING',
  "comments" TEXT,
  "acknowledgedById" TEXT,
  "acknowledgedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "design_change_acknowledgements_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "design_changes_changeNumber_key" ON "design_changes"("changeNumber");
CREATE INDEX "design_changes_projectId_status_idx" ON "design_changes"("projectId", "status");
CREATE INDEX "design_changes_status_targetDate_idx" ON "design_changes"("status", "targetDate");
CREATE UNIQUE INDEX "design_change_impacts_changeId_area_key" ON "design_change_impacts"("changeId", "area");
CREATE INDEX "design_change_impacts_ownerId_status_idx" ON "design_change_impacts"("ownerId", "status");
CREATE INDEX "design_change_affected_items_changeId_objectType_idx" ON "design_change_affected_items"("changeId", "objectType");
CREATE INDEX "design_change_affected_items_objectType_objectId_idx" ON "design_change_affected_items"("objectType", "objectId");
CREATE UNIQUE INDEX "design_change_acknowledgements_changeId_functionName_key" ON "design_change_acknowledgements"("changeId", "functionName");
CREATE INDEX "design_change_acknowledgements_ownerId_status_idx" ON "design_change_acknowledgements"("ownerId", "status");

ALTER TABLE "design_changes" ADD CONSTRAINT "design_changes_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "design_projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "design_change_impacts" ADD CONSTRAINT "design_change_impacts_changeId_fkey" FOREIGN KEY ("changeId") REFERENCES "design_changes"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "design_change_affected_items" ADD CONSTRAINT "design_change_affected_items_changeId_fkey" FOREIGN KEY ("changeId") REFERENCES "design_changes"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "design_change_acknowledgements" ADD CONSTRAINT "design_change_acknowledgements_changeId_fkey" FOREIGN KEY ("changeId") REFERENCES "design_changes"("id") ON DELETE CASCADE ON UPDATE CASCADE;
