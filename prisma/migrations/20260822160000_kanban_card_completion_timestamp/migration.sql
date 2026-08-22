ALTER TABLE "kanban_cards" ADD COLUMN "completedAt" TIMESTAMP(3);

-- Legacy done cards have no exact transition timestamp; updatedAt is the
-- closest available historical signal. All future transitions are exact.
UPDATE "kanban_cards" c
SET "completedAt" = c."updatedAt"
FROM "kanban_lists" l
WHERE c."listId" = l."id"
  AND l."isDoneList" = true
  AND c."status" = 'ACTIVE';

CREATE INDEX "kanban_cards_assigneeId_completedAt_idx"
ON "kanban_cards"("assigneeId", "completedAt");

ALTER TABLE "ping_recipients" ADD COLUMN "acknowledgedAt" TIMESTAMP(3);
UPDATE "ping_recipients"
SET "acknowledgedAt" = "respondedAt"
WHERE "status" = 'ACKNOWLEDGED';
