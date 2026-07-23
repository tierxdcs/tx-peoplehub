-- PLM Phase 1: thin, per-order-line lifecycle orchestration.

ALTER TABLE "employees"
  ADD COLUMN IF NOT EXISTS "isProductionHead" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "order_line_items"
  ADD COLUMN IF NOT EXISTS "vendorId" TEXT;

ALTER TABLE "kanban_cards"
  ADD COLUMN IF NOT EXISTS "plmTrackerId" TEXT;

ALTER TABLE "qms_inspections"
  ADD COLUMN IF NOT EXISTS "orderLineId" TEXT;

DO $$ BEGIN
  CREATE TYPE "PlmStage" AS ENUM (
    'DESIGN', 'DESIGN_REVIEW', 'DRAWING_RELEASE', 'RELEASE_TO_SCM',
    'MATERIAL_PLANNING', 'PRODUCTION', 'QC', 'DISPATCH', 'COMPLETED'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "PlmTrackerStatus" AS ENUM ('ACTIVE', 'COMPLETED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "PlmDesignReviewStatus" AS ENUM ('NOT_SUBMITTED', 'PENDING', 'APPROVED', 'REJECTED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "PlmEventType" AS ENUM (
    'CREATED', 'STAGE_CONFIRMED', 'DESIGN_REVIEW_SUBMITTED',
    'DESIGN_REVIEW_APPROVED', 'DESIGN_REVIEW_REJECTED',
    'DERIVED_SIGNAL_CONFIRMED', 'OWNER_CHANGED', 'PRODUCTION_BOARD_LINKED'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS "plm_trackers" (
  "id" TEXT NOT NULL,
  "orderLineId" TEXT NOT NULL,
  "orderId" TEXT NOT NULL,
  "kickoffId" TEXT NOT NULL,
  "flowType" "OrderLineDeliveryType" NOT NULL,
  "currentStage" "PlmStage" NOT NULL,
  "status" "PlmTrackerStatus" NOT NULL DEFAULT 'ACTIVE',
  "ownerId" TEXT NOT NULL,
  "vendorId" TEXT,
  "productionBoardId" TEXT,
  "designReviewStatus" "PlmDesignReviewStatus" NOT NULL DEFAULT 'NOT_SUBMITTED',
  "designSubmittedById" TEXT,
  "designSubmittedAt" TIMESTAMP(3),
  "designReviewedById" TEXT,
  "designReviewedAt" TIMESTAMP(3),
  "designReviewComment" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "plm_trackers_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "plm_tracker_events" (
  "id" TEXT NOT NULL,
  "trackerId" TEXT NOT NULL,
  "type" "PlmEventType" NOT NULL,
  "fromStage" "PlmStage",
  "toStage" "PlmStage",
  "actorId" TEXT,
  "comment" TEXT,
  "metadata" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "plm_tracker_events_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "plm_trackers_orderLineId_key" ON "plm_trackers"("orderLineId");
CREATE INDEX IF NOT EXISTS "plm_trackers_orderId_idx" ON "plm_trackers"("orderId");
CREATE INDEX IF NOT EXISTS "plm_trackers_kickoffId_idx" ON "plm_trackers"("kickoffId");
CREATE INDEX IF NOT EXISTS "plm_trackers_ownerId_idx" ON "plm_trackers"("ownerId");
CREATE INDEX IF NOT EXISTS "plm_trackers_currentStage_idx" ON "plm_trackers"("currentStage");
CREATE INDEX IF NOT EXISTS "plm_trackers_vendorId_idx" ON "plm_trackers"("vendorId");
CREATE INDEX IF NOT EXISTS "plm_tracker_events_trackerId_createdAt_idx" ON "plm_tracker_events"("trackerId", "createdAt");
CREATE INDEX IF NOT EXISTS "order_line_items_vendorId_idx" ON "order_line_items"("vendorId");
CREATE INDEX IF NOT EXISTS "kanban_cards_plmTrackerId_idx" ON "kanban_cards"("plmTrackerId");
CREATE INDEX IF NOT EXISTS "qms_inspections_orderLineId_idx" ON "qms_inspections"("orderLineId");

DO $$ BEGIN
  ALTER TABLE "order_line_items" ADD CONSTRAINT "order_line_items_vendorId_fkey"
    FOREIGN KEY ("vendorId") REFERENCES "vendors"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "kanban_cards" ADD CONSTRAINT "kanban_cards_plmTrackerId_fkey"
    FOREIGN KEY ("plmTrackerId") REFERENCES "plm_trackers"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "qms_inspections" ADD CONSTRAINT "qms_inspections_orderLineId_fkey"
    FOREIGN KEY ("orderLineId") REFERENCES "order_line_items"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "plm_trackers" ADD CONSTRAINT "plm_trackers_orderLineId_fkey"
    FOREIGN KEY ("orderLineId") REFERENCES "order_line_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  ALTER TABLE "plm_trackers" ADD CONSTRAINT "plm_trackers_orderId_fkey"
    FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  ALTER TABLE "plm_trackers" ADD CONSTRAINT "plm_trackers_kickoffId_fkey"
    FOREIGN KEY ("kickoffId") REFERENCES "project_kickoffs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  ALTER TABLE "plm_trackers" ADD CONSTRAINT "plm_trackers_ownerId_fkey"
    FOREIGN KEY ("ownerId") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  ALTER TABLE "plm_trackers" ADD CONSTRAINT "plm_trackers_vendorId_fkey"
    FOREIGN KEY ("vendorId") REFERENCES "vendors"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  ALTER TABLE "plm_trackers" ADD CONSTRAINT "plm_trackers_productionBoardId_fkey"
    FOREIGN KEY ("productionBoardId") REFERENCES "kanban_boards"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  ALTER TABLE "plm_trackers" ADD CONSTRAINT "plm_trackers_designSubmittedById_fkey"
    FOREIGN KEY ("designSubmittedById") REFERENCES "employees"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  ALTER TABLE "plm_trackers" ADD CONSTRAINT "plm_trackers_designReviewedById_fkey"
    FOREIGN KEY ("designReviewedById") REFERENCES "employees"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "plm_tracker_events" ADD CONSTRAINT "plm_tracker_events_trackerId_fkey"
    FOREIGN KEY ("trackerId") REFERENCES "plm_trackers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  ALTER TABLE "plm_tracker_events" ADD CONSTRAINT "plm_tracker_events_actorId_fkey"
    FOREIGN KEY ("actorId") REFERENCES "employees"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
