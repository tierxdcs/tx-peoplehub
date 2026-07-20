-- AlterTable
ALTER TABLE "kanban_cards" ADD COLUMN     "verticalId" TEXT;

-- CreateIndex
CREATE INDEX "kanban_cards_verticalId_idx" ON "kanban_cards"("verticalId");

-- AddForeignKey
ALTER TABLE "kanban_cards" ADD CONSTRAINT "kanban_cards_verticalId_fkey" FOREIGN KEY ("verticalId") REFERENCES "verticals"("id") ON DELETE SET NULL ON UPDATE CASCADE;
