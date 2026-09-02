-- Close a bid as LOST: an explicit, reasoned commercial loss.
--
-- Before this, a bid the customer awarded elsewhere had nowhere to go. REJECTED
-- means OUR approver refused the discount and EXPIRED only means `validUntil`
-- lapsed, so a lost bid sat on SENT forever and kept counting as live pipeline.
--
-- LOST is a dead end (never converts to an order, never live pipeline) but it
-- stays in the win-rate denominator, because a loss is still a bid that reached
-- the customer.
--
-- Purely additive: no backfill. Existing SENT/EXPIRED bids keep their status;
-- reclassifying a historical bid as lost is a deliberate human act through the
-- new endpoint, not something a migration should guess at.
ALTER TYPE "BidStatus" ADD VALUE 'LOST';

ALTER TABLE "bids" ADD COLUMN "lostReason" TEXT;
ALTER TABLE "bids" ADD COLUMN "closedAsLostById" TEXT;
ALTER TABLE "bids" ADD COLUMN "closedAsLostAt" TIMESTAMP(3);

CREATE INDEX "bids_closedAsLostById_idx" ON "bids"("closedAsLostById");

-- SetNull, matching `approverId`: off-boarding the rep who closed the bid must
-- never destroy the bid or its loss reason, only the attribution.
ALTER TABLE "bids"
  ADD CONSTRAINT "bids_closedAsLostById_fkey"
  FOREIGN KEY ("closedAsLostById") REFERENCES "employees"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
