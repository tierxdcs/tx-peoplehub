-- Customer-facing per-line display overrides (the customer's own PO wording).
-- Display-only: no FK/behavioral change; Product/BOM/PLM references untouched.
ALTER TABLE "order_line_items" ADD COLUMN "customerFacingProductName" TEXT;
ALTER TABLE "order_line_items" ADD COLUMN "customerFacingDescription" TEXT;
