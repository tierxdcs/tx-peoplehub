ALTER TABLE "boms"
  ADD COLUMN "isCostComplete" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "project_resource_plan_lines"
  ALTER COLUMN "benchmarkCostPerUnit" DROP NOT NULL,
  ADD COLUMN "isCostComplete" BOOLEAN NOT NULL DEFAULT false;

-- Existing non-null snapshots were produced only after the former release
-- hard-gate proved every exploded leaf had a cost.
UPDATE "boms"
SET "isCostComplete" = true
WHERE "rolledUpCostSnapshot" IS NOT NULL;

UPDATE "project_resource_plan_lines"
SET "isCostComplete" = true
WHERE "benchmarkCostPerUnit" IS NOT NULL;
