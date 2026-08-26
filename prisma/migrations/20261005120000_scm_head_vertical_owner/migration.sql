-- Add a single-holder SCM Head capability. The application keeps this flag
-- and the SCM vertical owner in sync when the designation is changed.
ALTER TABLE "employees"
ADD COLUMN "isScmHead" BOOLEAN NOT NULL DEFAULT false;

-- Preserve any SCM owner already configured by recognizing that employee as
-- the initial SCM Head. This makes the migration safe for existing companies.
UPDATE "employees" e
SET "isScmHead" = true
FROM "verticals" v
WHERE UPPER(v."code") = 'SCM'
  AND v."ownerId" = e."id";
