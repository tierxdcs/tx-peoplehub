-- BOM-intake provenance is already retained by customer_bom_intakes. It was
-- incorrectly copied into Product.description, which is printed verbatim on
-- customer-facing proposals. Clear only that generated legacy description;
-- genuine product specifications remain untouched.
UPDATE "products" AS p
SET "description" = NULL
FROM "customer_bom_intakes" AS intake
WHERE intake."productId" = p."id"
  AND p."description" ILIKE 'Created from customer BOM intake for %';
