ALTER TABLE "items"
  ADD COLUMN "manualStandardCost" DECIMAL(14,2);

ALTER TABLE "boms"
  ADD COLUMN "rolledUpCostSnapshot" DECIMAL(18,2),
  ADD COLUMN "costSnapshotAt" TIMESTAMP(3);

ALTER TABLE "products"
  ADD COLUMN "targetMarginPercent" DECIMAL(5,2);

ALTER TABLE "products"
  ADD CONSTRAINT "products_target_margin_percent_check"
  CHECK ("targetMarginPercent" IS NULL OR ("targetMarginPercent" >= 0 AND "targetMarginPercent" < 100));
