-- Kanban card attachments (files stored in R2, keyed per card). Idempotent so
-- it is safe to (re-)run on any database state.

-- CreateEnum
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'KanbanCardAttachmentStatus') THEN
    CREATE TYPE "KanbanCardAttachmentStatus" AS ENUM ('PENDING', 'ACTIVE');
  END IF;
END $$;

-- CreateTable
CREATE TABLE IF NOT EXISTS "kanban_card_attachments" (
    "id" TEXT NOT NULL,
    "cardId" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "contentType" TEXT NOT NULL,
    "sizeBytes" BIGINT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "status" "KanbanCardAttachmentStatus" NOT NULL DEFAULT 'PENDING',
    "uploadedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "kanban_card_attachments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "kanban_card_attachments_cardId_createdAt_idx" ON "kanban_card_attachments"("cardId", "createdAt");

-- AddForeignKey
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'kanban_card_attachments_cardId_fkey' AND conrelid = 'kanban_card_attachments'::regclass) THEN
    ALTER TABLE "kanban_card_attachments" ADD CONSTRAINT "kanban_card_attachments_cardId_fkey" FOREIGN KEY ("cardId") REFERENCES "kanban_cards"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'kanban_card_attachments_uploadedById_fkey' AND conrelid = 'kanban_card_attachments'::regclass) THEN
    ALTER TABLE "kanban_card_attachments" ADD CONSTRAINT "kanban_card_attachments_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;
