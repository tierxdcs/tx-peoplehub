-- CreateEnum
CREATE TYPE "BidAssessmentQuestionType" AS ENUM ('BOOLEAN', 'TEXT', 'SCALE', 'SELECT');

-- CreateEnum
CREATE TYPE "BidAssessmentStatus" AS ENUM ('PENDING_REVIEW', 'APPROVED', 'REJECTED');

-- AlterTable
ALTER TABLE "employees" ADD COLUMN     "isSalesHead" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "bid_assessment_questions" (
    "id" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "type" "BidAssessmentQuestionType" NOT NULL,
    "options" JSONB,
    "displayOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "bid_assessment_questions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bid_decision_assessments" (
    "id" TEXT NOT NULL,
    "opportunityId" TEXT NOT NULL,
    "submittedById" TEXT NOT NULL,
    "status" "BidAssessmentStatus" NOT NULL DEFAULT 'PENDING_REVIEW',
    "reviewedById" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "reviewerComments" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "bid_decision_assessments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bid_assessment_responses" (
    "id" TEXT NOT NULL,
    "assessmentId" TEXT NOT NULL,
    "questionId" TEXT NOT NULL,
    "questionTextSnapshot" TEXT NOT NULL,
    "answerValue" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "bid_assessment_responses_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "bid_assessment_questions_isActive_displayOrder_idx" ON "bid_assessment_questions"("isActive", "displayOrder");

-- CreateIndex
CREATE INDEX "bid_decision_assessments_opportunityId_createdAt_idx" ON "bid_decision_assessments"("opportunityId", "createdAt");

-- CreateIndex
CREATE INDEX "bid_decision_assessments_status_idx" ON "bid_decision_assessments"("status");

-- CreateIndex
CREATE INDEX "bid_assessment_responses_assessmentId_idx" ON "bid_assessment_responses"("assessmentId");

-- AddForeignKey
ALTER TABLE "bid_decision_assessments" ADD CONSTRAINT "bid_decision_assessments_opportunityId_fkey" FOREIGN KEY ("opportunityId") REFERENCES "opportunities"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bid_decision_assessments" ADD CONSTRAINT "bid_decision_assessments_submittedById_fkey" FOREIGN KEY ("submittedById") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bid_decision_assessments" ADD CONSTRAINT "bid_decision_assessments_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "employees"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bid_assessment_responses" ADD CONSTRAINT "bid_assessment_responses_assessmentId_fkey" FOREIGN KEY ("assessmentId") REFERENCES "bid_decision_assessments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bid_assessment_responses" ADD CONSTRAINT "bid_assessment_responses_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "bid_assessment_questions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

