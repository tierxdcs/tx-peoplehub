-- Re-anchor the offer letter from Employee to the selected candidate application.
--
-- Before this migration a letter could not exist without an Employee row, which
-- forced HR to onboard the hire (employee code, official email, salary
-- structure, PF/ESIC/PAN, bank account, vault folder) BEFORE the offer could be
-- drafted — and there was no way to record whether the candidate ever accepted.
-- After it the ladder runs: application SELECTED -> offer approved and sent
-- (requisition OFFER_EXTENDED) -> candidate accepts -> onboarding
-- (CANDIDATE_SELECTED).
--
-- Every step is additive or a constraint RELAXATION; no column is dropped and no
-- row is rewritten, so existing employee-anchored letters keep working verbatim.

-- 1. "The candidate declined" is our record of THEIR refusal, and is not the
--    same fact as REJECTED (our decision about them).
ALTER TYPE "CandidateApplicationStatus" ADD VALUE 'OFFER_DECLINED';

-- 2. A letter is now authored before the Employee row exists.
ALTER TABLE "offer_letters" ALTER COLUMN "employeeId" DROP NOT NULL;

-- 3. The candidate the offer is addressed to.
ALTER TABLE "offer_letters" ADD COLUMN "candidateApplicationId" TEXT;
CREATE UNIQUE INDEX "offer_letters_candidateApplicationId_key"
  ON "offer_letters"("candidateApplicationId");
ALTER TABLE "offer_letters"
  ADD CONSTRAINT "offer_letters_candidateApplicationId_fkey"
  FOREIGN KEY ("candidateApplicationId") REFERENCES "candidate_applications"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

-- 4. A declined offer is followed by a fresh one to the next applicant on the
--    SAME requisition, so the requisition -> letter relation stops being 1:1.
--    CandidateRequisition.consumedAt remains the "one live offer" guard.
DROP INDEX IF EXISTS "offer_letters_candidateRequisitionId_key";
CREATE INDEX "offer_letters_candidateRequisitionId_idx"
  ON "offer_letters"("candidateRequisitionId");

-- 5. The offered employment terms. With no Employee row there is nowhere else
--    for them to live, and what we OFFERED must stay readable even if the terms
--    are renegotiated before joining. Null on legacy employee-anchored letters,
--    which still read the Employee row.
ALTER TABLE "offer_letters"
  ADD COLUMN "offeredDesignation" TEXT,
  ADD COLUMN "offeredEmploymentType" "EmploymentType",
  ADD COLUMN "offeredDateOfJoining" DATE,
  ADD COLUMN "offeredWorkLocation" TEXT,
  ADD COLUMN "offeredTerritory" TEXT,
  ADD COLUMN "offeredMonthlyCtc" DECIMAL(14,2),
  ADD COLUMN "reportsToId" TEXT;
CREATE INDEX "offer_letters_reportsToId_idx" ON "offer_letters"("reportsToId");
ALTER TABLE "offer_letters"
  ADD CONSTRAINT "offer_letters_reportsToId_fkey"
  FOREIGN KEY ("reportsToId") REFERENCES "employees"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- 6. The candidate-response axis, deliberately NOT folded into
--    OfferLetterStatus: "we approved it" and "they took it" are different facts,
--    and every existing gate that reads APPROVED means the former.
ALTER TABLE "offer_letters"
  ADD COLUMN "sentAt" TIMESTAMP(3),
  ADD COLUMN "acceptedAt" TIMESTAMP(3),
  ADD COLUMN "declinedAt" TIMESTAMP(3),
  ADD COLUMN "declineReason" TEXT;

-- 7. Back-fill the response axis for letters that predate it. An already-onboarded
--    requisition is proof the candidate accepted; an APPROVED letter was, by the
--    old flow, necessarily written for someone already onboarded. Without this
--    every historical letter would look "never sent", and the new onboarding gate
--    would refuse a re-onboarding of a hire whose offer plainly was accepted.
UPDATE "offer_letters" o
SET "sentAt" = COALESCE(o."ceoApprovedAt", o."updatedAt"),
    "acceptedAt" = COALESCE(o."ceoApprovedAt", o."updatedAt")
WHERE o."status" = 'APPROVED' AND o."acceptedAt" IS NULL;
