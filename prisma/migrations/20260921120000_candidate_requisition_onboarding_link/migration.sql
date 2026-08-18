ALTER TABLE "candidate_requisitions"
  ADD COLUMN "onboardedEmployeeId" TEXT;

CREATE UNIQUE INDEX "candidate_requisitions_onboardedEmployeeId_key"
  ON "candidate_requisitions"("onboardedEmployeeId");

ALTER TABLE "candidate_requisitions"
  ADD CONSTRAINT "candidate_requisitions_onboardedEmployeeId_fkey"
  FOREIGN KEY ("onboardedEmployeeId") REFERENCES "employees"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
