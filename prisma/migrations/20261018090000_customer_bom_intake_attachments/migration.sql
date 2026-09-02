ALTER TABLE "customer_bom_intakes"
ADD COLUMN "rawAttachments" JSONB;

UPDATE "customer_bom_intakes"
SET "rawAttachments" = jsonb_build_array(
  jsonb_build_object('key', "rawFileKey", 'name', "rawFileName")
)
WHERE "rawFileKey" IS NOT NULL AND "rawFileName" IS NOT NULL;
