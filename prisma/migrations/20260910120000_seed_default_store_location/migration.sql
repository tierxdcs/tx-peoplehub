-- Store locations were previously created only by prisma/seed.ts. Production
-- deployments run migrations but do not necessarily run the development seed,
-- leaving GRN Store / Bin selectors empty. Provision the safe default
-- idempotently without changing or reactivating any administrator-managed row.
INSERT INTO "store_locations" (
  "id",
  "code",
  "name",
  "isActive",
  "createdAt",
  "updatedAt"
)
VALUES (
  gen_random_uuid()::text,
  'MAIN',
  'Main Store',
  true,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
)
ON CONFLICT ("code") DO NOTHING;
