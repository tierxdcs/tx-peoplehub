-- Offer letters move from a single-stage approval (one `approverId`/`decidedAt`
-- pair) to a two-stage flow mirroring candidate requisitions: the vertical owner
-- gives the first sign-off, then the CEO gives the final one. This migration adds
-- the stage-specific audit columns, backfills the audit trail from the old
-- single-stage columns, swaps the enum (via a text intermediate — Postgres can't
-- add + use a new enum value in one transaction, nor drop old values in place),
-- and drops the old columns/index/FK.

-- 1. New stage-specific audit columns (nullable).
ALTER TABLE "offer_letters"
    ADD COLUMN "verticalApprovedById" TEXT,
    ADD COLUMN "verticalApprovedAt" TIMESTAMP(3),
    ADD COLUMN "ceoApprovedById" TEXT,
    ADD COLUMN "ceoApprovedAt" TIMESTAMP(3),
    ADD COLUMN "rejectedById" TEXT,
    ADD COLUMN "rejectedAt" TIMESTAMP(3);

-- 2. Backfill the audit trail from the old single-stage columns before dropping
--    them. The old model recorded only one approver, so an APPROVED letter's sole
--    approver is stamped as both stages (best-effort); a REJECTED letter's is
--    recorded as the rejecter.
UPDATE "offer_letters"
   SET "verticalApprovedById" = "approverId",
       "verticalApprovedAt"   = "decidedAt",
       "ceoApprovedById"      = "approverId",
       "ceoApprovedAt"        = "decidedAt"
 WHERE "status" = 'APPROVED';

UPDATE "offer_letters"
   SET "rejectedById" = "approverId",
       "rejectedAt"   = "decidedAt"
 WHERE "status" = 'REJECTED';

-- 3. Enum swap via a text intermediate. Every in-flight single-stage
--    PENDING_APPROVAL letter restarts at the vertical stage: a letter with a
--    real vertical owner now needs owner→CEO; an owner-less one is finalised by
--    the CEO directly from the vertical stage. DRAFT/APPROVED/REJECTED are
--    unchanged names and cast straight across.
ALTER TABLE "offer_letters" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "offer_letters" ALTER COLUMN "status" TYPE TEXT USING "status"::text;
UPDATE "offer_letters" SET "status" = 'PENDING_VERTICAL_APPROVAL' WHERE "status" = 'PENDING_APPROVAL';
ALTER TYPE "OfferLetterStatus" RENAME TO "OfferLetterStatus_old";
CREATE TYPE "OfferLetterStatus" AS ENUM ('DRAFT', 'PENDING_VERTICAL_APPROVAL', 'PENDING_CEO_APPROVAL', 'APPROVED', 'REJECTED');
ALTER TABLE "offer_letters" ALTER COLUMN "status" TYPE "OfferLetterStatus" USING "status"::"OfferLetterStatus";
ALTER TABLE "offer_letters" ALTER COLUMN "status" SET DEFAULT 'DRAFT';
DROP TYPE "OfferLetterStatus_old";

-- 4. Drop the old single-stage index, FK and columns.
DROP INDEX "offer_letters_status_approverId_idx";
ALTER TABLE "offer_letters" DROP CONSTRAINT "offer_letters_approverId_fkey";
ALTER TABLE "offer_letters" DROP COLUMN "approverId";
ALTER TABLE "offer_letters" DROP COLUMN "decidedAt";

-- 5. New status index + FKs for the stage-specific approvers/rejecter.
CREATE INDEX "offer_letters_status_idx" ON "offer_letters"("status");

ALTER TABLE "offer_letters" ADD CONSTRAINT "offer_letters_verticalApprovedById_fkey"
    FOREIGN KEY ("verticalApprovedById") REFERENCES "employees"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "offer_letters" ADD CONSTRAINT "offer_letters_ceoApprovedById_fkey"
    FOREIGN KEY ("ceoApprovedById") REFERENCES "employees"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "offer_letters" ADD CONSTRAINT "offer_letters_rejectedById_fkey"
    FOREIGN KEY ("rejectedById") REFERENCES "employees"("id") ON DELETE SET NULL ON UPDATE CASCADE;
