-- Milestone Templates: admin-managed standard-milestone catalogue keyed by
-- delivery flow type (reuses the existing "OrderLineDeliveryType" enum). Drives
-- the milestone dropdown at kickoff (union by the order lines' delivery types).

CREATE TABLE "milestone_templates" (
  "id" TEXT NOT NULL,
  "flowType" "OrderLineDeliveryType" NOT NULL,
  "name" TEXT NOT NULL,
  "displayOrder" INTEGER NOT NULL DEFAULT 0,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "milestone_templates_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "milestone_templates_flowType_name_key" ON "milestone_templates"("flowType", "name");
CREATE INDEX "milestone_templates_flowType_isActive_idx" ON "milestone_templates"("flowType", "isActive");

-- Production-safe baseline configuration. The application seed repeats these as
-- idempotent upserts for local/test resets; this insert ensures deploys that
-- run migrations (but not `prisma db seed`) receive the confirmed defaults.
-- name is unique only within a flow type, so the same milestone (e.g. "Material
-- Ready", "QC Sign-off") intentionally recurs across NPD / IN_HOUSE / VENDOR.
INSERT INTO "milestone_templates" ("id", "flowType", "name", "displayOrder", "isActive", "createdAt", "updatedAt")
VALUES
  -- NPD
  (gen_random_uuid()::text, 'NPD',      'Design Concept Finalisation',      1,  true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'NPD',      'Design Review Sign-off',           2,  true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'NPD',      'Drawing Finalisation',             3,  true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'NPD',      'Prototype/Sample Approval',        4,  true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'NPD',      'Material Ready',                   5,  true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'NPD',      'Production Start',                 6,  true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'NPD',      'Packing Standard Finalised',       7,  true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'NPD',      'Label & Branding',                 8,  true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'NPD',      'QC Sign-off',                      9,  true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'NPD',      'Logistics & Delivery',            10,  true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  -- IN_HOUSE
  (gen_random_uuid()::text, 'IN_HOUSE', 'Material Ready',                   1,  true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'IN_HOUSE', 'Production Start',                 2,  true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'IN_HOUSE', 'Packing Standard Finalised',       3,  true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'IN_HOUSE', 'Label & Branding',                 4,  true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'IN_HOUSE', 'QC Sign-off',                      5,  true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'IN_HOUSE', 'Logistics & Delivery',             6,  true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  -- VENDOR
  (gen_random_uuid()::text, 'VENDOR',   'Material Ready (Vendor Confirmed)', 1, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'VENDOR',   'Production Start (Vendor)',        2,  true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'VENDOR',   'Packing Standard Finalised',       3,  true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'VENDOR',   'Label & Branding',                 4,  true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'VENDOR',   'QC Sign-off',                      5,  true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'VENDOR',   'Logistics & Delivery',             6,  true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("flowType", "name") DO NOTHING;
