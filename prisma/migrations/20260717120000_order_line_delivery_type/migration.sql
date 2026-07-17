-- Per-line-item delivery classification (set at project kickoff). All additive
-- and nullable — the bid→order conversion and Order detail page are unaffected.
CREATE TYPE "OrderLineDeliveryType" AS ENUM ('NPD', 'IN_HOUSE', 'VENDOR');

ALTER TABLE "order_line_items" ADD COLUMN "deliveryType" "OrderLineDeliveryType";
ALTER TABLE "order_line_items" ADD COLUMN "vendorName" TEXT;
ALTER TABLE "order_line_items" ADD COLUMN "vendorContactInfo" TEXT;
ALTER TABLE "order_line_items" ADD COLUMN "vendorExpectedLeadTime" TEXT;
