-- AlterTable: done-list marker (position type is DOUBLE PRECISION already, folded into the base kanban migration).
ALTER TABLE "kanban_lists" ADD COLUMN     "isDoneList" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "kanban_labels" (
    "id" TEXT NOT NULL,
    "boardId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "color" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "kanban_labels_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "kanban_card_labels" (
    "cardId" TEXT NOT NULL,
    "labelId" TEXT NOT NULL,

    CONSTRAINT "kanban_card_labels_pkey" PRIMARY KEY ("cardId","labelId")
);

-- CreateIndex
CREATE INDEX "kanban_labels_boardId_idx" ON "kanban_labels"("boardId");

-- CreateIndex
CREATE INDEX "kanban_card_labels_labelId_idx" ON "kanban_card_labels"("labelId");

-- AddForeignKey
ALTER TABLE "kanban_labels" ADD CONSTRAINT "kanban_labels_boardId_fkey" FOREIGN KEY ("boardId") REFERENCES "kanban_boards"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "kanban_card_labels" ADD CONSTRAINT "kanban_card_labels_cardId_fkey" FOREIGN KEY ("cardId") REFERENCES "kanban_cards"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "kanban_card_labels" ADD CONSTRAINT "kanban_card_labels_labelId_fkey" FOREIGN KEY ("labelId") REFERENCES "kanban_labels"("id") ON DELETE CASCADE ON UPDATE CASCADE;
