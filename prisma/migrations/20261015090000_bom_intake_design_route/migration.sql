-- Route a quote-stage BOM intake through the design team when the customer
-- stated a requirement rather than a parts list.
--
-- The intake parks in DESIGN_PENDING (SCM's quote-stage RFQ picker only ever
-- looks at CREATED intakes, so sourcing cannot see it yet), a design request
-- carries the link both ways, and the BOM the design team hands over flips the
-- intake to CREATED — from which point the existing RFQ path works unchanged.
--
-- Purely additive: no backfill, because no existing intake was ever raised this
-- way (every one of them already has its transcribed BOM).
ALTER TYPE "CustomerBomIntakeStatus" ADD VALUE 'DESIGN_PENDING';
ALTER TYPE "DesignRequestSource" ADD VALUE 'SALES_QUOTE';

ALTER TABLE "design_requests" ADD COLUMN "customerBomIntakeId" TEXT;

CREATE INDEX "design_requests_customerBomIntakeId_idx" ON "design_requests"("customerBomIntakeId");

-- SetNull like every other cross-module link on a design request: deleting the
-- commercial record never destroys design history.
ALTER TABLE "design_requests"
  ADD CONSTRAINT "design_requests_customerBomIntakeId_fkey"
  FOREIGN KEY ("customerBomIntakeId") REFERENCES "customer_bom_intakes"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
