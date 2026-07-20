CREATE TABLE "kanban_done_list_backfill_report" (
  "id" TEXT NOT NULL,
  "boardId" TEXT NOT NULL,
  "boardName" TEXT NOT NULL,
  "selectedListId" TEXT NOT NULL,
  "selectedListName" TEXT NOT NULL,
  "selectionReason" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "kanban_done_list_backfill_report_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "kanban_done_list_backfill_report_boardId_key"
  ON "kanban_done_list_backfill_report"("boardId");

-- Boards created before lists were auto-provisioned may have no lists at all.
INSERT INTO "kanban_lists" ("id", "boardId", "name", "position", "isDoneList", "createdById", "createdAt", "updatedAt")
SELECT md5(b."id" || ':todo')::uuid::text, b."id", 'To Do', 1024, false, b."createdById", CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "kanban_boards" b WHERE NOT EXISTS (SELECT 1 FROM "kanban_lists" l WHERE l."boardId" = b."id");
INSERT INTO "kanban_lists" ("id", "boardId", "name", "position", "isDoneList", "createdById", "createdAt", "updatedAt")
SELECT md5(b."id" || ':progress')::uuid::text, b."id", 'In progress', 2048, false, b."createdById", CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "kanban_boards" b
WHERE (SELECT count(*) FROM "kanban_lists" l WHERE l."boardId" = b."id") = 1
  AND EXISTS (SELECT 1 FROM "kanban_lists" l WHERE l."boardId" = b."id" AND l."id" = md5(b."id" || ':todo')::uuid::text);
INSERT INTO "kanban_lists" ("id", "boardId", "name", "position", "isDoneList", "createdById", "createdAt", "updatedAt")
SELECT md5(b."id" || ':completed')::uuid::text, b."id", 'Completed', 3072, true, b."createdById", CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "kanban_boards" b
WHERE (SELECT count(*) FROM "kanban_lists" l WHERE l."boardId" = b."id") = 2
  AND EXISTS (SELECT 1 FROM "kanban_lists" l WHERE l."boardId" = b."id" AND l."id" = md5(b."id" || ':todo')::uuid::text);

INSERT INTO "kanban_done_list_backfill_report"
  ("id", "boardId", "boardName", "selectedListId", "selectedListName", "selectionReason")
SELECT md5(b."id" || ':done-report')::uuid::text, b."id", b."name", l."id", l."name", 'DEFAULT_LISTS_CREATED_FOR_EMPTY_BOARD'
FROM "kanban_boards" b
JOIN "kanban_lists" l ON l."boardId" = b."id" AND l."isDoneList" = true
WHERE l."id" = md5(b."id" || ':completed')::uuid::text;

-- For boards with lists but no done list, prefer the last-positioned list whose
-- name is a common completion term; otherwise choose the final list.
WITH candidates AS (
  SELECT DISTINCT ON (b."id")
    b."id" AS "boardId", b."name" AS "boardName", l."id" AS "listId", l."name" AS "listName",
    CASE WHEN lower(trim(l."name")) ~ '^(completed|done|closed|finished|shipped)$'
      THEN 'MATCHED_COMPLETION_NAME' ELSE 'FALLBACK_LAST_BY_POSITION' END AS reason
  FROM "kanban_boards" b
  JOIN "kanban_lists" l ON l."boardId" = b."id"
  WHERE NOT EXISTS (SELECT 1 FROM "kanban_lists" d WHERE d."boardId" = b."id" AND d."isDoneList" = true)
  ORDER BY b."id",
    (lower(trim(l."name")) ~ '^(completed|done|closed|finished|shipped)$') DESC,
    l."position" DESC
)
INSERT INTO "kanban_done_list_backfill_report"
  ("id", "boardId", "boardName", "selectedListId", "selectedListName", "selectionReason")
SELECT md5(c."boardId" || ':done-report')::uuid::text, c."boardId", c."boardName", c."listId", c."listName", c.reason
FROM candidates c ON CONFLICT ("boardId") DO NOTHING;

UPDATE "kanban_lists" l SET "isDoneList" = true, "updatedAt" = CURRENT_TIMESTAMP
FROM "kanban_done_list_backfill_report" r
WHERE l."id" = r."selectedListId" AND l."isDoneList" = false;

-- Normalize any historical board that somehow acquired multiple done lists.
WITH keepers AS (
  SELECT DISTINCT ON (b."id") b."id" AS "boardId", b."name" AS "boardName", l."id" AS "listId", l."name" AS "listName"
  FROM "kanban_boards" b JOIN "kanban_lists" l ON l."boardId" = b."id" AND l."isDoneList" = true
  WHERE (SELECT count(*) FROM "kanban_lists" d WHERE d."boardId" = b."id" AND d."isDoneList" = true) > 1
  ORDER BY b."id", l."position" DESC
)
INSERT INTO "kanban_done_list_backfill_report"
  ("id", "boardId", "boardName", "selectedListId", "selectedListName", "selectionReason")
SELECT md5(k."boardId" || ':done-report')::uuid::text, k."boardId", k."boardName", k."listId", k."listName", 'MULTIPLE_DONE_LISTS_NORMALIZED'
FROM keepers k ON CONFLICT ("boardId") DO UPDATE SET
  "selectedListId" = EXCLUDED."selectedListId", "selectedListName" = EXCLUDED."selectedListName",
  "selectionReason" = EXCLUDED."selectionReason";

UPDATE "kanban_lists" l SET "isDoneList" = false, "updatedAt" = CURRENT_TIMESTAMP
FROM "kanban_done_list_backfill_report" r
WHERE l."boardId" = r."boardId" AND l."isDoneList" = true AND l."id" <> r."selectedListId"
  AND r."selectionReason" = 'MULTIPLE_DONE_LISTS_NORMALIZED';

-- Database guard for the single-holder half of the invariant. The service
-- guarantees the at-least-one half and performs reassignment transactionally.
CREATE UNIQUE INDEX "kanban_lists_one_done_per_board"
  ON "kanban_lists"("boardId") WHERE "isDoneList" = true;
