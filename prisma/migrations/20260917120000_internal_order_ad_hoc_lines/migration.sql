-- Internal sample/speculative orders may begin with an unresolved product.
-- Customer-order promotion remains the formalization gate in application code.
ALTER TABLE "order_line_items"
  ALTER COLUMN "productId" DROP NOT NULL,
  ADD COLUMN "adHocProductName" TEXT,
  ADD COLUMN "adHocDescription" TEXT;
