-- Add mandatory-in-DTO role description fields to candidate requisitions.
-- Nullable in the DB so the columns can be added to existing rows without a
-- backfill; the create DTO enforces that every new requisition provides them.
ALTER TABLE "candidate_requisitions" ADD COLUMN "keyResponsibilities" TEXT;
ALTER TABLE "candidate_requisitions" ADD COLUMN "keyPerformanceIndicators" TEXT;
