-- ============================================================================
-- Idempotent hotfix: bring PRODUCTION up to the Kanban Phase 5 schema.
--
-- WHY: production applied the base kanban migration (20260711150000) at its
-- first deploy, when kanban_lists/kanban_cards.position was INTEGER and there
-- was no isDoneList column or label tables. The Phase 5 migration
-- (20260711160000_kanban_phase5_labels) has not reached prod, so creating a
-- list — which now inserts isDoneList — throws and returns a 500.
--
-- This script is safe to run MORE THAN ONCE. Every step is guarded, so a
-- partially-migrated database converges to the correct state without error.
-- Run it inside a transaction (the Railway Postgres console wraps statements,
-- but BEGIN/COMMIT here makes the all-or-nothing intent explicit).
--
-- After this runs, `prisma migrate deploy` on the next deploy will see the
-- 20260711160000 row already present and skip it — no drift, no double-apply.
-- ============================================================================

BEGIN;

-- ── 1. Phase 5 column: done-list marker ──────────────────────────────────
ALTER TABLE "kanban_lists"
  ADD COLUMN IF NOT EXISTS "isDoneList" BOOLEAN NOT NULL DEFAULT false;

-- ── 2. Fractional ordering: position must be DOUBLE PRECISION ─────────────
-- Folded into the base migration in the repo, but prod deployed the base
-- migration while position was still INTEGER. Widening INT → DOUBLE PRECISION
-- is a lossless, re-runnable no-op once already applied.
ALTER TABLE "kanban_lists"
  ALTER COLUMN "position" TYPE DOUBLE PRECISION;
ALTER TABLE "kanban_cards"
  ALTER COLUMN "position" TYPE DOUBLE PRECISION;

-- ── 3. Phase 5 tables: labels + card↔label join ──────────────────────────
CREATE TABLE IF NOT EXISTS "kanban_labels" (
    "id" TEXT NOT NULL,
    "boardId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "color" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "kanban_labels_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "kanban_card_labels" (
    "cardId" TEXT NOT NULL,
    "labelId" TEXT NOT NULL,
    CONSTRAINT "kanban_card_labels_pkey" PRIMARY KEY ("cardId","labelId")
);

CREATE INDEX IF NOT EXISTS "kanban_labels_boardId_idx"
  ON "kanban_labels"("boardId");
CREATE INDEX IF NOT EXISTS "kanban_card_labels_labelId_idx"
  ON "kanban_card_labels"("labelId");

-- ── 4. Foreign keys (constraints have no IF NOT EXISTS — guard each) ──────
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'kanban_labels_boardId_fkey') THEN
    ALTER TABLE "kanban_labels"
      ADD CONSTRAINT "kanban_labels_boardId_fkey"
      FOREIGN KEY ("boardId") REFERENCES "kanban_boards"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'kanban_card_labels_cardId_fkey') THEN
    ALTER TABLE "kanban_card_labels"
      ADD CONSTRAINT "kanban_card_labels_cardId_fkey"
      FOREIGN KEY ("cardId") REFERENCES "kanban_cards"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'kanban_card_labels_labelId_fkey') THEN
    ALTER TABLE "kanban_card_labels"
      ADD CONSTRAINT "kanban_card_labels_labelId_fkey"
      FOREIGN KEY ("labelId") REFERENCES "kanban_labels"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- ── 5. Record the migration so `prisma migrate deploy` skips it next time ─
-- checksum = sha256 of prisma/migrations/20260711160000_kanban_phase5_labels/migration.sql
INSERT INTO "_prisma_migrations" (
    "id", "checksum", "finished_at", "migration_name",
    "logs", "rolled_back_at", "started_at", "applied_steps_count"
)
SELECT
    gen_random_uuid()::text,
    '858e9a0000a5d533b993334e97c481af33a713fb95e2f99e3c481eaefee27da7',
    now(),
    '20260711160000_kanban_phase5_labels',
    NULL, NULL, now(), 1
WHERE NOT EXISTS (
    SELECT 1 FROM "_prisma_migrations"
    WHERE "migration_name" = '20260711160000_kanban_phase5_labels'
);

COMMIT;

-- ── Verification (run after COMMIT; all three should confirm) ─────────────
-- Column present + type:
--   SELECT column_name, data_type FROM information_schema.columns
--   WHERE table_name IN ('kanban_lists','kanban_cards')
--     AND column_name IN ('isDoneList','position') ORDER BY table_name, column_name;
-- Tables present:
--   SELECT table_name FROM information_schema.tables
--   WHERE table_name IN ('kanban_labels','kanban_card_labels');
-- Migration recorded:
--   SELECT migration_name, finished_at FROM "_prisma_migrations"
--   WHERE migration_name = '20260711160000_kanban_phase5_labels';
