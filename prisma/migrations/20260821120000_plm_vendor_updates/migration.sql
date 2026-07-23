CREATE TYPE "PlmUpdateReporterType" AS ENUM ('VENDOR_SELF_REPORT', 'INTERNAL_AUDITOR_VISIT');

ALTER TYPE "PlmEventType" ADD VALUE 'VENDOR_INVITE_CREATED';
ALTER TYPE "PlmEventType" ADD VALUE 'VENDOR_INVITE_REVOKED';
ALTER TYPE "PlmEventType" ADD VALUE 'PRODUCTION_UPDATE_REPORTED';

CREATE TABLE "plm_vendor_update_invites" (
  "id" TEXT NOT NULL,
  "trackerId" TEXT NOT NULL,
  "token" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "revokedAt" TIMESTAMP(3),
  "passwordHash" TEXT,
  "createdById" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "plm_vendor_update_invites_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "plm_production_updates" (
  "id" TEXT NOT NULL,
  "trackerId" TEXT NOT NULL,
  "reporterType" "PlmUpdateReporterType" NOT NULL,
  "internalReporterId" TEXT,
  "reporterDisplayName" TEXT NOT NULL,
  "fabricationPercent" INTEGER NOT NULL,
  "surfaceFinishPercent" INTEGER NOT NULL,
  "assemblyPercent" INTEGER NOT NULL,
  "notes" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "plm_production_updates_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "plm_production_update_photos" (
  "id" TEXT NOT NULL,
  "updateId" TEXT NOT NULL,
  "storageKey" TEXT NOT NULL,
  "fileName" TEXT NOT NULL,
  "sizeBytes" INTEGER NOT NULL,
  "mimeType" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "plm_production_update_photos_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "plm_vendor_update_invites_token_key" ON "plm_vendor_update_invites"("token");
CREATE INDEX "plm_vendor_update_invites_trackerId_idx" ON "plm_vendor_update_invites"("trackerId");
CREATE INDEX "plm_production_updates_trackerId_createdAt_idx" ON "plm_production_updates"("trackerId", "createdAt");
CREATE UNIQUE INDEX "plm_production_update_photos_storageKey_key" ON "plm_production_update_photos"("storageKey");
CREATE INDEX "plm_production_update_photos_updateId_idx" ON "plm_production_update_photos"("updateId");

ALTER TABLE "plm_vendor_update_invites" ADD CONSTRAINT "plm_vendor_update_invites_trackerId_fkey" FOREIGN KEY ("trackerId") REFERENCES "plm_trackers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "plm_vendor_update_invites" ADD CONSTRAINT "plm_vendor_update_invites_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "plm_production_updates" ADD CONSTRAINT "plm_production_updates_trackerId_fkey" FOREIGN KEY ("trackerId") REFERENCES "plm_trackers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "plm_production_updates" ADD CONSTRAINT "plm_production_updates_internalReporterId_fkey" FOREIGN KEY ("internalReporterId") REFERENCES "employees"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "plm_production_update_photos" ADD CONSTRAINT "plm_production_update_photos_updateId_fkey" FOREIGN KEY ("updateId") REFERENCES "plm_production_updates"("id") ON DELETE CASCADE ON UPDATE CASCADE;
