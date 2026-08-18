CREATE TYPE "CandidateHiringStage" AS ENUM (
  'JOB_POSTED',
  'INTERVIEWING',
  'OFFER_EXTENDED',
  'CANDIDATE_SELECTED'
);

ALTER TABLE "candidate_requisitions"
  ADD COLUMN "hiringStage" "CandidateHiringStage",
  ADD COLUMN "selectedCandidateName" TEXT;

CREATE INDEX "candidate_requisitions_hiringStage_idx"
  ON "candidate_requisitions"("hiringStage");
