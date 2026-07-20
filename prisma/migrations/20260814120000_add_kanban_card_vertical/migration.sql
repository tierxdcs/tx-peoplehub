-- AlterTable
ALTER TABLE "kanban_cards" ADD COLUMN IF NOT EXISTS "verticalId" TEXT;

-- CreateIndex
CREATE INDEX IF NOT EXISTS "kanban_cards_verticalId_idx"
  ON "kanban_cards"("verticalId");

-- AddForeignKey
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
