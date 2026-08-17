-- Sales margin: let the sales team apply their own markup on a bid, at both the
-- per-line and bid level (mirrors the existing line/bid discount inputs).
-- Additive and backfill-free: the bid-level margin defaults to 0 and the
-- per-line margin is nullable, so existing bids are unchanged (no margin
-- applied). The margin is folded into each line's stored unitPrice/lineTotal at
-- creation; these columns retain the applied % for audit/reporting only and are
-- never printed on the customer proposal.

-- AlterTable
ALTER TABLE "bids"
  ADD COLUMN "marginPercent" DECIMAL(5,2) NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "bid_line_items"
  ADD COLUMN "marginPercent" DECIMAL(5,2);
