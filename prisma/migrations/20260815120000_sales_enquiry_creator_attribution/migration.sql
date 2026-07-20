-- Preserve the user who originated an enquiry throughout the complete sales
-- chain. Existing rows use the closest historical owner/creator as a safe,
-- reviewable approximation because creator data was not previously retained.

ALTER TABLE "leads" ADD COLUMN "enquiryCreatorId" TEXT;
UPDATE "leads" SET "enquiryCreatorId" = "ownerId";
ALTER TABLE "leads" ALTER COLUMN "enquiryCreatorId" SET NOT NULL;

ALTER TABLE "opportunities" ADD COLUMN "enquiryCreatorId" TEXT;
UPDATE "opportunities" o
SET "enquiryCreatorId" = COALESCE(l."enquiryCreatorId", o."ownerId")
FROM "leads" l
WHERE l."convertedToOpportunityId" = o."id";
UPDATE "opportunities"
SET "enquiryCreatorId" = "ownerId"
WHERE "enquiryCreatorId" IS NULL;
ALTER TABLE "opportunities" ALTER COLUMN "enquiryCreatorId" SET NOT NULL;

ALTER TABLE "bids" ADD COLUMN "enquiryCreatorId" TEXT;
UPDATE "bids" b
SET "enquiryCreatorId" = COALESCE(o."enquiryCreatorId", b."createdById")
FROM "opportunities" o
WHERE o."id" = b."opportunityId";
UPDATE "bids"
SET "enquiryCreatorId" = "createdById"
WHERE "enquiryCreatorId" IS NULL;
ALTER TABLE "bids" ALTER COLUMN "enquiryCreatorId" SET NOT NULL;

ALTER TABLE "orders" ADD COLUMN "enquiryCreatorId" TEXT;
UPDATE "orders" o
SET "enquiryCreatorId" = COALESCE(b."enquiryCreatorId", o."ownerId")
FROM "bids" b
WHERE b."id" = o."bidId";
UPDATE "orders"
SET "enquiryCreatorId" = "ownerId"
WHERE "enquiryCreatorId" IS NULL;
CREATE INDEX "leads_enquiryCreatorId_idx" ON "leads"("enquiryCreatorId");
CREATE INDEX "opportunities_enquiryCreatorId_idx" ON "opportunities"("enquiryCreatorId");
CREATE INDEX "bids_enquiryCreatorId_idx" ON "bids"("enquiryCreatorId");
CREATE INDEX "orders_enquiryCreatorId_idx" ON "orders"("enquiryCreatorId");

ALTER TABLE "leads" ADD CONSTRAINT "leads_enquiryCreatorId_fkey"
  FOREIGN KEY ("enquiryCreatorId") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "opportunities" ADD CONSTRAINT "opportunities_enquiryCreatorId_fkey"
  FOREIGN KEY ("enquiryCreatorId") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "bids" ADD CONSTRAINT "bids_enquiryCreatorId_fkey"
  FOREIGN KEY ("enquiryCreatorId") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "orders" ADD CONSTRAINT "orders_enquiryCreatorId_fkey"
  FOREIGN KEY ("enquiryCreatorId") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
