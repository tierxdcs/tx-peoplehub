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
