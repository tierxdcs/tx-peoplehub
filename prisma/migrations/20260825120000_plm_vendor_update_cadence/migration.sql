-- Kickoff is the single source of truth for every tracker in the project.
ALTER TABLE "project_kickoffs"
ADD COLUMN "vendorUpdateCadenceDays" INTEGER NOT NULL DEFAULT 1;

CREATE TYPE "PlmVendorUpdateType" AS ENUM ('FULL_PROGRESS', 'COMMENT_ONLY');

ALTER TABLE "plm_production_updates"
ADD COLUMN "updateType" "PlmVendorUpdateType" NOT NULL DEFAULT 'FULL_PROGRESS',
ALTER COLUMN "fabricationPercent" DROP NOT NULL,
ALTER COLUMN "surfaceFinishPercent" DROP NOT NULL,
ALTER COLUMN "assemblyPercent" DROP NOT NULL;
