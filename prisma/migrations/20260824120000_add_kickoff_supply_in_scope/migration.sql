-- Add supplyInScope with a safe default so existing rows never end up NULL.
ALTER TABLE "project_kickoffs"
    ADD COLUMN "supplyInScope" BOOLEAN NOT NULL DEFAULT true;

-- Backfill existing kickoffs using the same rule applied at creation time:
-- false only when the linked order has at least one line item AND every one
-- of them is classified VENDOR. Anything else (mixed, NPD/IN_HOUSE present, or
-- no classified lines yet) keeps the true default.
UPDATE "project_kickoffs" k
SET "supplyInScope" = false
WHERE EXISTS (
    SELECT 1 FROM "order_line_items" li WHERE li."orderId" = k."orderId"
)
AND NOT EXISTS (
    SELECT 1 FROM "order_line_items" li
    WHERE li."orderId" = k."orderId"
      AND (li."deliveryType" IS DISTINCT FROM 'VENDOR')
);
