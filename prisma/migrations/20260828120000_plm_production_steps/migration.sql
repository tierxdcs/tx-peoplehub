-- Sequential fabrication routing progress for vendor production updates.
-- `completedSteps` is the count of completed steps (0..N) in the fixed routing
-- (Material, Cut, Punch, Bend, Weld, Coat, Assemble, QC, Pack). The progress
-- bar is derived from it. The legacy *_percent columns are retained (nullable)
-- so historical updates still render.
ALTER TABLE "plm_production_updates" ADD COLUMN "completedSteps" INTEGER;
