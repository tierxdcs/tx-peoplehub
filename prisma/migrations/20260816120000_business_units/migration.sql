-- Business units (Phaze Edge / Infrastructure / …) + businessUnitId on the
-- Product catalog AND the sales pipeline (Lead / Opportunity / Bid / Order).
-- Fully idempotent and id-agnostic so it is safe to (re-)run on any database
-- state, including one already seeded with UUID-keyed business units.

-- CreateTable
CREATE TABLE IF NOT EXISTS "business_units" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "description" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "displayOrder" INTEGER NOT NULL DEFAULT 0,
    "colorHex" TEXT NOT NULL DEFAULT '#2563EB',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "business_units_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "business_units_name_key" ON "business_units"("name");
CREATE UNIQUE INDEX IF NOT EXISTS "business_units_code_key" ON "business_units"("code");
ALTER TABLE "business_units" ADD COLUMN IF NOT EXISTS "colorHex" TEXT NOT NULL DEFAULT '#2563EB';

-- Seed the six default units if they are not already present (matched by code).
-- gen_random_uuid() keeps ids consistent with the app's uuid default.
INSERT INTO "business_units" ("id", "name", "code", "description", "displayOrder", "colorHex", "updatedAt") VALUES
  (gen_random_uuid(), 'Phaze Edge', 'EDGE', 'Edge and micro data-centre solutions.', 1, '#2563EB', CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'Phaze Infrastructure', 'INFRA', 'Racks, cabinets, enclosures and physical infrastructure.', 2, '#64748B', CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'Phaze Hyperscale', 'HYPERSCALE', 'Hyperscale and OCP/ORV-class deployments.', 3, '#7C3AED', CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'Phaze MOD', 'MOD', 'Modular and containerised data-centre systems.', 4, '#0891B2', CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'Phaze Intelligence', 'INTELLIGENCE', 'Monitoring, software and intelligent systems.', 5, '#D97706', CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'Phaze Services', 'SERVICES', 'Services, support and everything not otherwise classified.', 6, '#059669', CURRENT_TIMESTAMP)
ON CONFLICT ("code") DO NOTHING;

-- Columns (nullable first so they can be added to populated tables safely).
ALTER TABLE "products"      ADD COLUMN IF NOT EXISTS "autoAssignedBusinessUnit" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "products"      ADD COLUMN IF NOT EXISTS "businessUnitId" TEXT;
ALTER TABLE "leads"         ADD COLUMN IF NOT EXISTS "businessUnitId" TEXT;
ALTER TABLE "opportunities" ADD COLUMN IF NOT EXISTS "businessUnitId" TEXT;
ALTER TABLE "bids"          ADD COLUMN IF NOT EXISTS "businessUnitId" TEXT;
ALTER TABLE "orders"        ADD COLUMN IF NOT EXISTS "businessUnitId" TEXT;

-- Backfill the NOT-NULL pipeline columns (Lead/Opportunity/Bid). Products are
-- deliberately NOT backfilled here: a blunt SQL fallback can't run the keyword
-- inference, so classifying products is left to the dedicated, reported script
-- scripts/backfill-product-business-units.ts (Product.businessUnitId is
-- nullable, so leaving them unset until then is safe). Resolve the Services
-- fallback by CODE (id-agnostic); cascade the pipeline where a link exists so a
-- deal keeps one BU end to end.
DO $$
DECLARE services_id TEXT;
BEGIN
  SELECT "id" INTO services_id FROM "business_units" WHERE "code" = 'SERVICES';

  UPDATE "leads" SET "businessUnitId" = services_id WHERE "businessUnitId" IS NULL;

  UPDATE "opportunities" o SET "businessUnitId" = COALESCE(l."businessUnitId", services_id)
    FROM "leads" l WHERE l."convertedToOpportunityId" = o."id" AND o."businessUnitId" IS NULL;
  UPDATE "opportunities" SET "businessUnitId" = services_id WHERE "businessUnitId" IS NULL;

  UPDATE "bids" b SET "businessUnitId" = o."businessUnitId"
    FROM "opportunities" o WHERE o."id" = b."opportunityId" AND b."businessUnitId" IS NULL;
  UPDATE "bids" SET "businessUnitId" = services_id WHERE "businessUnitId" IS NULL;

  UPDATE "orders" o SET "businessUnitId" = b."businessUnitId"
    FROM "bids" b WHERE b."id" = o."bidId" AND o."businessUnitId" IS NULL;
END $$;

-- Enforce NOT NULL where the model requires it (Lead/Opportunity/Bid). Product
-- and Order stay nullable by design. Guarded so re-runs are no-ops.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='leads' AND column_name='businessUnitId' AND is_nullable='YES') THEN
    ALTER TABLE "leads" ALTER COLUMN "businessUnitId" SET NOT NULL;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='opportunities' AND column_name='businessUnitId' AND is_nullable='YES') THEN
    ALTER TABLE "opportunities" ALTER COLUMN "businessUnitId" SET NOT NULL;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='bids' AND column_name='businessUnitId' AND is_nullable='YES') THEN
    ALTER TABLE "bids" ALTER COLUMN "businessUnitId" SET NOT NULL;
  END IF;
END $$;

-- Indexes.
CREATE INDEX IF NOT EXISTS "products_businessUnitId_idx"      ON "products"("businessUnitId");
CREATE INDEX IF NOT EXISTS "leads_businessUnitId_idx"         ON "leads"("businessUnitId");
CREATE INDEX IF NOT EXISTS "opportunities_businessUnitId_idx" ON "opportunities"("businessUnitId");
CREATE INDEX IF NOT EXISTS "bids_businessUnitId_idx"          ON "bids"("businessUnitId");
CREATE INDEX IF NOT EXISTS "orders_businessUnitId_idx"        ON "orders"("businessUnitId");

-- Foreign keys (each guarded so re-runs skip an existing constraint).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='products_businessUnitId_fkey' AND conrelid='products'::regclass) THEN
    ALTER TABLE "products" ADD CONSTRAINT "products_businessUnitId_fkey" FOREIGN KEY ("businessUnitId") REFERENCES "business_units"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='leads_businessUnitId_fkey' AND conrelid='leads'::regclass) THEN
    ALTER TABLE "leads" ADD CONSTRAINT "leads_businessUnitId_fkey" FOREIGN KEY ("businessUnitId") REFERENCES "business_units"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='opportunities_businessUnitId_fkey' AND conrelid='opportunities'::regclass) THEN
    ALTER TABLE "opportunities" ADD CONSTRAINT "opportunities_businessUnitId_fkey" FOREIGN KEY ("businessUnitId") REFERENCES "business_units"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='bids_businessUnitId_fkey' AND conrelid='bids'::regclass) THEN
    ALTER TABLE "bids" ADD CONSTRAINT "bids_businessUnitId_fkey" FOREIGN KEY ("businessUnitId") REFERENCES "business_units"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='orders_businessUnitId_fkey' AND conrelid='orders'::regclass) THEN
    ALTER TABLE "orders" ADD CONSTRAINT "orders_businessUnitId_fkey" FOREIGN KEY ("businessUnitId") REFERENCES "business_units"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;
