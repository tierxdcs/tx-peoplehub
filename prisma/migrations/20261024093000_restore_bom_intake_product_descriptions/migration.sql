-- Restore the actual requirement as the Product description for BOM-intake
-- products. Only the internal provenance/customer prefix should be removed.
UPDATE "products" AS p
SET "description" = CASE
  WHEN lower(o."name") LIKE lower(c."name" || ' — %')
    THEN substring(o."name" FROM char_length(c."name") + 4)
  WHEN lower(o."name") LIKE lower(c."name" || ' – %')
    THEN substring(o."name" FROM char_length(c."name") + 4)
  WHEN lower(o."name") LIKE lower(c."name" || ' - %')
    THEN substring(o."name" FROM char_length(c."name") + 4)
  ELSE o."name"
END
FROM "customer_bom_intakes" AS intake
JOIN "opportunities" AS o ON o."id" = intake."opportunityId"
JOIN "customers" AS c ON c."id" = o."customerId"
WHERE intake."productId" = p."id"
  AND (p."description" IS NULL
    OR p."description" ILIKE 'Created from customer BOM intake for %');
