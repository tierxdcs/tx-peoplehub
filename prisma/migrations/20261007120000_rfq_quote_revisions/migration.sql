-- Per-vendor negotiated quote revisions.
--
-- SCM can reopen ONE invitee's submission link after the RFQ has closed, so a
-- negotiated follow-up quote is captured as a tracked revision instead of being
-- agreed outside the system. A revision is a new rfq_quotes row at the next
-- revisionNumber; nothing is ever overwritten.

-- 1. The per-invitee revision window (scoped to the invitee, not the RFQ).
ALTER TABLE "rfq_invitees"
ADD COLUMN "revisionRequestedAt" TIMESTAMP(3),
ADD COLUMN "revisionRequestedById" TEXT,
ADD COLUMN "revisionDeadline" TIMESTAMP(3),
ADD COLUMN "revisionNote" TEXT;

ALTER TABLE "rfq_invitees"
ADD CONSTRAINT "rfq_invitees_revisionRequestedById_fkey"
FOREIGN KEY ("revisionRequestedById") REFERENCES "employees"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

-- 2. Quotes carry a revision number and their own submission timestamp.
ALTER TABLE "rfq_quotes"
ADD COLUMN "revisionNumber" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN "submittedAt" TIMESTAMP(3);

-- Every existing quote is revision 1 (the column default). Its submission
-- timestamp lived on the invitee; copy it down so history is complete from day
-- one. A saved-but-never-submitted draft correctly keeps a NULL submittedAt.
UPDATE "rfq_quotes" q
SET "submittedAt" = i."submittedAt"
FROM "rfq_invitees" i
WHERE i."id" = q."inviteeId"
  AND i."submittedAt" IS NOT NULL;

-- 3. An invitee may now hold several quotes — one per revision. Uniqueness moves
-- from the invitee to the (invitee, revision) pair.
DROP INDEX "rfq_quotes_inviteeId_key";

CREATE UNIQUE INDEX "rfq_quotes_inviteeId_revisionNumber_key"
ON "rfq_quotes"("inviteeId", "revisionNumber");

CREATE INDEX "rfq_quotes_inviteeId_idx" ON "rfq_quotes"("inviteeId");
