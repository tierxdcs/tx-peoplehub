-- CreateEnum
CREATE TYPE "KanbanBoardStatus" AS ENUM ('ACTIVE', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "KanbanCardStatus" AS ENUM ('ACTIVE', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "KanbanSprintDuration" AS ENUM ('ONE_WEEK', 'TWO_WEEKS', 'THREE_WEEKS', 'FOUR_WEEKS');

-- CreateEnum
CREATE TYPE "NotificationType" AS ENUM ('CARD_ASSIGNED', 'CARD_COMMENTED', 'CARD_UPDATED');

-- AlterTable
ALTER TABLE "employees" ADD COLUMN     "isScrumMaster" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "kanban_boards" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "status" "KanbanBoardStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "kanban_boards_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "kanban_board_members" (
    "id" TEXT NOT NULL,
    "boardId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "addedById" TEXT NOT NULL,
    "addedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "kanban_board_members_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "kanban_lists" (
    "id" TEXT NOT NULL,
    "boardId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "kanban_lists_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "kanban_sprints" (
    "id" TEXT NOT NULL,
    "boardId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "durationWeeks" "KanbanSprintDuration" NOT NULL,
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3) NOT NULL,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "kanban_sprints_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "kanban_cards" (
    "id" TEXT NOT NULL,
    "listId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "assigneeId" TEXT,
    "startDate" TIMESTAMP(3),
    "dueDate" TIMESTAMP(3),
    "priority" "LeadPriority" NOT NULL DEFAULT 'MEDIUM',
    "sprintId" TEXT,
    "position" DOUBLE PRECISION NOT NULL,
    "createdById" TEXT NOT NULL,
    "status" "KanbanCardStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "kanban_cards_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "kanban_card_comments" (
    "id" TEXT NOT NULL,
    "cardId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "kanban_card_comments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "kanban_card_activity" (
    "id" TEXT NOT NULL,
    "cardId" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "kanban_card_activity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notifications" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "type" "NotificationType" NOT NULL,
    "relatedCardId" TEXT,
    "message" TEXT NOT NULL,
    "isRead" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "kanban_boards_status_idx" ON "kanban_boards"("status");

-- CreateIndex
CREATE INDEX "kanban_board_members_employeeId_idx" ON "kanban_board_members"("employeeId");

-- CreateIndex
CREATE UNIQUE INDEX "kanban_board_members_boardId_employeeId_key" ON "kanban_board_members"("boardId", "employeeId");

-- CreateIndex
CREATE INDEX "kanban_lists_boardId_position_idx" ON "kanban_lists"("boardId", "position");

-- CreateIndex
CREATE INDEX "kanban_sprints_boardId_idx" ON "kanban_sprints"("boardId");

-- CreateIndex
CREATE INDEX "kanban_cards_listId_position_idx" ON "kanban_cards"("listId", "position");

-- CreateIndex
CREATE INDEX "kanban_cards_sprintId_idx" ON "kanban_cards"("sprintId");

-- CreateIndex
CREATE INDEX "kanban_cards_assigneeId_idx" ON "kanban_cards"("assigneeId");

-- CreateIndex
CREATE INDEX "kanban_card_comments_cardId_createdAt_idx" ON "kanban_card_comments"("cardId", "createdAt");

-- CreateIndex
CREATE INDEX "kanban_card_activity_cardId_createdAt_idx" ON "kanban_card_activity"("cardId", "createdAt");

-- CreateIndex
CREATE INDEX "notifications_employeeId_isRead_idx" ON "notifications"("employeeId", "isRead");

-- AddForeignKey
ALTER TABLE "kanban_boards" ADD CONSTRAINT "kanban_boards_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "kanban_board_members" ADD CONSTRAINT "kanban_board_members_boardId_fkey" FOREIGN KEY ("boardId") REFERENCES "kanban_boards"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "kanban_board_members" ADD CONSTRAINT "kanban_board_members_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "employees"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "kanban_board_members" ADD CONSTRAINT "kanban_board_members_addedById_fkey" FOREIGN KEY ("addedById") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "kanban_lists" ADD CONSTRAINT "kanban_lists_boardId_fkey" FOREIGN KEY ("boardId") REFERENCES "kanban_boards"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "kanban_lists" ADD CONSTRAINT "kanban_lists_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "kanban_sprints" ADD CONSTRAINT "kanban_sprints_boardId_fkey" FOREIGN KEY ("boardId") REFERENCES "kanban_boards"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "kanban_sprints" ADD CONSTRAINT "kanban_sprints_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "kanban_cards" ADD CONSTRAINT "kanban_cards_listId_fkey" FOREIGN KEY ("listId") REFERENCES "kanban_lists"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "kanban_cards" ADD CONSTRAINT "kanban_cards_assigneeId_fkey" FOREIGN KEY ("assigneeId") REFERENCES "employees"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "kanban_cards" ADD CONSTRAINT "kanban_cards_sprintId_fkey" FOREIGN KEY ("sprintId") REFERENCES "kanban_sprints"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "kanban_cards" ADD CONSTRAINT "kanban_cards_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "kanban_card_comments" ADD CONSTRAINT "kanban_card_comments_cardId_fkey" FOREIGN KEY ("cardId") REFERENCES "kanban_cards"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "kanban_card_comments" ADD CONSTRAINT "kanban_card_comments_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "kanban_card_activity" ADD CONSTRAINT "kanban_card_activity_cardId_fkey" FOREIGN KEY ("cardId") REFERENCES "kanban_cards"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "kanban_card_activity" ADD CONSTRAINT "kanban_card_activity_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "employees"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_relatedCardId_fkey" FOREIGN KEY ("relatedCardId") REFERENCES "kanban_cards"("id") ON DELETE CASCADE ON UPDATE CASCADE;

