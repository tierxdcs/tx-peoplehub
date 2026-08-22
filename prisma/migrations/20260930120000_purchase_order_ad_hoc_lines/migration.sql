ALTER TABLE "purchase_order_lines"
  ALTER COLUMN "itemId" DROP NOT NULL,
  ADD COLUMN "adHocItemName" TEXT,
  ADD COLUMN "adHocDescription" TEXT;

ALTER TABLE "purchase_order_lines"
  ADD CONSTRAINT "purchase_order_lines_exactly_one_item_source"
  CHECK (
    (("itemId" IS NOT NULL)::int +
     (CASE WHEN length(btrim("adHocItemName")) > 0 THEN 1 ELSE 0 END)) = 1
  );
