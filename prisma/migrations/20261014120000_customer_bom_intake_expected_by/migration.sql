-- The date Sales promised the customer a price for a quote-stage BOM. Nullable
-- with no backfill: existing intakes simply show no progress bar until someone
-- sets a date on them.
ALTER TABLE "customer_bom_intakes" ADD COLUMN "expectedBy" TIMESTAMP(3);
