-- Purchase Order email audit: when the PO PDF was last mailed to the party, and
-- to which address. Purely additive and nullable — every existing PO simply
-- reads "never emailed".
ALTER TABLE "purchase_orders"
  ADD COLUMN "lastEmailedAt" TIMESTAMP(3),
  ADD COLUMN "lastEmailedTo" TEXT;
