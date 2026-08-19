-- Split a Kickoff order line's quantity across multiple vendors, each with its
-- own PLM tracker. Introduces OrderLineDeliverySplit and re-anchors PlmTracker
-- from the order line to the split, preserving all existing tracker history.

-- CreateTable
CREATE TABLE "order_line_delivery_splits" (
    "id" TEXT NOT NULL,
    "orderLineId" TEXT NOT NULL,
    "quantity" DECIMAL(14,2) NOT NULL,
    "deliveryType" "OrderLineDeliveryType",
    "vendorName" TEXT,
    "vendorContactInfo" TEXT,
    "vendorExpectedLeadTime" TEXT,
    "vendorId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "order_line_delivery_splits_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "order_line_delivery_splits_orderLineId_idx" ON "order_line_delivery_splits"("orderLineId");

-- CreateIndex
CREATE INDEX "order_line_delivery_splits_vendorId_idx" ON "order_line_delivery_splits"("vendorId");

-- AddForeignKey
ALTER TABLE "order_line_delivery_splits" ADD CONSTRAINT "order_line_delivery_splits_orderLineId_fkey" FOREIGN KEY ("orderLineId") REFERENCES "order_line_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_line_delivery_splits" ADD CONSTRAINT "order_line_delivery_splits_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "vendors"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Backfill: one default split per already-classified order line (deliveryType
-- set), holding the full line quantity and copying the flat vendor placeholder
-- fields. Every existing PLM tracker's order line is classified, so each gets a
-- split to re-anchor to below.
INSERT INTO "order_line_delivery_splits" (
    "id", "orderLineId", "quantity", "deliveryType",
    "vendorName", "vendorContactInfo", "vendorExpectedLeadTime", "vendorId",
    "createdAt", "updatedAt"
)
SELECT
    gen_random_uuid(), "id", "quantity", "deliveryType",
    "vendorName", "vendorContactInfo", "vendorExpectedLeadTime", "vendorId",
    now(), now()
FROM "order_line_items"
WHERE "deliveryType" IS NOT NULL;

-- Re-anchor PlmTracker onto the split: add nullable, backfill from each
-- tracker's default split, then enforce NOT NULL. (Adding NOT NULL directly
-- would fail on existing rows.)
ALTER TABLE "plm_trackers" ADD COLUMN "splitId" TEXT;

UPDATE "plm_trackers" t
SET "splitId" = s."id"
FROM "order_line_delivery_splits" s
WHERE s."orderLineId" = t."orderLineId";

ALTER TABLE "plm_trackers" ALTER COLUMN "splitId" SET NOT NULL;

-- DropIndex: the old 1:1 line anchor is gone (a line now has one tracker per split).
DROP INDEX "plm_trackers_orderLineId_key";

-- CreateIndex
CREATE UNIQUE INDEX "plm_trackers_splitId_key" ON "plm_trackers"("splitId");

-- CreateIndex
CREATE INDEX "plm_trackers_orderLineId_idx" ON "plm_trackers"("orderLineId");

-- AddForeignKey
ALTER TABLE "plm_trackers" ADD CONSTRAINT "plm_trackers_splitId_fkey" FOREIGN KEY ("splitId") REFERENCES "order_line_delivery_splits"("id") ON DELETE CASCADE ON UPDATE CASCADE;
