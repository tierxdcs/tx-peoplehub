-- Stores follow-up: promote GRN logistics / sign-off fields to real columns
-- (spec §3.1). Purely additive and nullable — existing GRNs keep NULLs and no
-- behaviour changes. Structured logistics data previously stuffed into `notes`
-- now has dedicated, queryable columns; `notes` reverts to free-text remarks.

CREATE TYPE "PackingCondition" AS ENUM ('GOOD', 'DAMAGED', 'PARTIALLY_DAMAGED');

ALTER TABLE "goods_receipt_notes"
  ADD COLUMN "vendorDeliveryChallanNumber" TEXT,
  ADD COLUMN "deliveryChallanDate" TIMESTAMP(3),
  ADD COLUMN "vehicleOrAwbNumber" TEXT,
  ADD COLUMN "driverOrCourier" TEXT,
  ADD COLUMN "totalPackagesReceived" INTEGER,
  ADD COLUMN "packingCondition" "PackingCondition",
  ADD COLUMN "supervisorSignOffId" TEXT;

ALTER TABLE "goods_receipt_notes"
  ADD CONSTRAINT "goods_receipt_notes_supervisorSignOffId_fkey"
  FOREIGN KEY ("supervisorSignOffId") REFERENCES "employees"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
