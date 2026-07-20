-- Compatibility guard: this backfill was originally ordered before the
-- migration that introduced verticalId. Ensure the schema exists first so the
-- migration is safe on older production databases as well as fresh installs.
ALTER TABLE "kanban_cards" ADD COLUMN IF NOT EXISTS "verticalId" TEXT;

CREATE INDEX IF NOT EXISTS "kanban_cards_verticalId_idx"
  ON "kanban_cards"("verticalId");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'kanban_cards_verticalId_fkey'
      AND conrelid = 'kanban_cards'::regclass
  ) THEN
    ALTER TABLE "kanban_cards"
      ADD CONSTRAINT "kanban_cards_verticalId_fkey"
      FOREIGN KEY ("verticalId") REFERENCES "verticals"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

-- Card vertical is server-managed and follows the assignee. Normalize all
-- historical cards so manually selected or stale values cannot survive.
UPDATE "kanban_cards" c
SET "verticalId" = e."verticalId", "updatedAt" = CURRENT_TIMESTAMP
FROM "employees" e
WHERE c."assigneeId" = e."id"
  AND c."verticalId" IS DISTINCT FROM e."verticalId";

UPDATE "kanban_cards"
SET "verticalId" = NULL, "updatedAt" = CURRENT_TIMESTAMP
WHERE "assigneeId" IS NULL AND "verticalId" IS NOT NULL;
