-- Catalog pricing: a product whose cost comes from an approved RFQ now carries a
-- default 20% target margin, and its unit price is derived from the released BOM
-- cost at that margin.

ALTER TABLE "products"
  ADD COLUMN "autoPricedFromBomCost" BOOLEAN NOT NULL DEFAULT false;

-- Every existing product gets the default target so the catalog can show a
-- margin against its released BOM cost. Prices are deliberately NOT touched:
-- a price already on the catalog may have been quoted to a customer, so it
-- stands, and the Actual Margin column now shows how far short of 20% it falls.
UPDATE "products"
  SET "targetMarginPercent" = 20
  WHERE "targetMarginPercent" IS NULL;

-- A zero price was never a pricing decision — it is a product waiting for its
-- cost. Let those follow the released BOM cost from now on. Anything with a
-- real price stays human-owned.
UPDATE "products"
  SET "autoPricedFromBomCost" = true
  WHERE "unitPrice" = 0;
