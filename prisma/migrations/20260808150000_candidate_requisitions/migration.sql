CREATE TYPE "CandidateRequisitionStatus" AS ENUM ('PENDING_VERTICAL_APPROVAL', 'REJECTED', 'PENDING_SUPERADMIN_APPROVAL', 'APPROVED');

CREATE TABLE "candidate_requisitions" (
  "id" TEXT NOT NULL,
  "requisitionNumber" TEXT NOT NULL,
  "requestedById" TEXT NOT NULL,
  "verticalId" TEXT NOT NULL,
  "positionTitle" TEXT NOT NULL,
  "employmentType" "EmploymentType" NOT NULL,
  "justification" TEXT NOT NULL,
  "targetJoiningDate" DATE,
  "status" "CandidateRequisitionStatus" NOT NULL DEFAULT 'PENDING_VERTICAL_APPROVAL',
  "verticalApprovedById" TEXT,
  "verticalApprovedAt" TIMESTAMP(3),
  "superAdminApprovedById" TEXT,
  "superAdminApprovedAt" TIMESTAMP(3),
  "rejectedById" TEXT,
  "rejectedAt" TIMESTAMP(3),
  "rejectionComment" TEXT,
  "consumedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "candidate_requisitions_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "offer_letters" ADD COLUMN "candidateRequisitionId" TEXT;

CREATE UNIQUE INDEX "candidate_requisitions_requisitionNumber_key" ON "candidate_requisitions"("requisitionNumber");
CREATE INDEX "candidate_requisitions_requestedById_status_idx" ON "candidate_requisitions"("requestedById", "status");
CREATE INDEX "candidate_requisitions_verticalId_status_idx" ON "candidate_requisitions"("verticalId", "status");
CREATE INDEX "candidate_requisitions_status_createdAt_idx" ON "candidate_requisitions"("status", "createdAt");
CREATE UNIQUE INDEX "offer_letters_candidateRequisitionId_key" ON "offer_letters"("candidateRequisitionId");

ALTER TABLE "candidate_requisitions" ADD CONSTRAINT "candidate_requisitions_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "candidate_requisitions" ADD CONSTRAINT "candidate_requisitions_verticalId_fkey" FOREIGN KEY ("verticalId") REFERENCES "verticals"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "candidate_requisitions" ADD CONSTRAINT "candidate_requisitions_verticalApprovedById_fkey" FOREIGN KEY ("verticalApprovedById") REFERENCES "employees"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "candidate_requisitions" ADD CONSTRAINT "candidate_requisitions_superAdminApprovedById_fkey" FOREIGN KEY ("superAdminApprovedById") REFERENCES "employees"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "candidate_requisitions" ADD CONSTRAINT "candidate_requisitions_rejectedById_fkey" FOREIGN KEY ("rejectedById") REFERENCES "employees"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "offer_letters" ADD CONSTRAINT "offer_letters_candidateRequisitionId_fkey" FOREIGN KEY ("candidateRequisitionId") REFERENCES "candidate_requisitions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
