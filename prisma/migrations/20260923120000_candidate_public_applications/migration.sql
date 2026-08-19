CREATE TYPE "CandidateApplicationStatus" AS ENUM ('SUBMITTED', 'UNDER_REVIEW', 'INTERVIEW_SCHEDULED', 'SELECTED', 'REJECTED');

CREATE TABLE "candidate_application_invites" (
  "id" TEXT NOT NULL,
  "requisitionId" TEXT NOT NULL,
  "token" TEXT NOT NULL,
  "passwordHash" TEXT,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "revokedAt" TIMESTAMP(3),
  "createdById" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "candidate_application_invites_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "candidate_applications" (
  "id" TEXT NOT NULL,
  "requisitionId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "contact" TEXT NOT NULL,
  "areaOfExpertise" TEXT NOT NULL,
  "totalExperienceYears" DECIMAL(5,2) NOT NULL,
  "relevantExperienceYears" DECIMAL(5,2) NOT NULL,
  "currentCtc" DECIMAL(14,2),
  "expectedCtc" DECIMAL(14,2),
  "aboutExperience" TEXT NOT NULL,
  "projects" TEXT,
  "resumeFileKey" TEXT NOT NULL,
  "resumeFileName" TEXT NOT NULL,
  "resumeFileSize" INTEGER NOT NULL,
  "resumeMimeType" TEXT NOT NULL,
  "status" "CandidateApplicationStatus" NOT NULL DEFAULT 'SUBMITTED',
  "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "candidate_applications_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "candidate_application_invites_token_key" ON "candidate_application_invites"("token");
CREATE INDEX "candidate_application_invites_requisitionId_revokedAt_idx" ON "candidate_application_invites"("requisitionId", "revokedAt");
CREATE INDEX "candidate_applications_requisitionId_status_submittedAt_idx" ON "candidate_applications"("requisitionId", "status", "submittedAt");
ALTER TABLE "candidate_application_invites" ADD CONSTRAINT "candidate_application_invites_requisitionId_fkey" FOREIGN KEY ("requisitionId") REFERENCES "candidate_requisitions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "candidate_applications" ADD CONSTRAINT "candidate_applications_requisitionId_fkey" FOREIGN KEY ("requisitionId") REFERENCES "candidate_requisitions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
