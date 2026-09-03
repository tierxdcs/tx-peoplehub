-- Purchase Order GST.
--
-- Order-level GST rates applied once to the summed line total, mirroring the
-- Sales Voucher. `gstStateCode` is the SUPPLIER's GST state: the company's own
-- state (29, Karnataka) makes the purchase intra-state (CGST + SGST), anywhere
-- else inter-state (IGST).
--
-- Every existing order keeps a zero rate. That is deliberate rather than a
-- backfill gap: those orders were placed, approved and in some cases already
-- received against a tax-exclusive value, and retro-fitting 18% would silently
-- restate a commitment the party already accepted.
ALTER TABLE "purchase_orders"
  ADD COLUMN "gstStateCode" TEXT NOT NULL DEFAULT '29',
  ADD COLUMN "gstIgstRate" DECIMAL(5, 2) NOT NULL DEFAULT 0,
  ADD COLUMN "gstCgstRate" DECIMAL(5, 2) NOT NULL DEFAULT 0,
  ADD COLUMN "gstSgstRate" DECIMAL(5, 2) NOT NULL DEFAULT 0;
