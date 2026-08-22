-- CreateEnum
CREATE TYPE "DesignReviewOutcome" AS ENUM ('APPROVED', 'APPROVED_WITH_CONDITIONS', 'REJECTED');

-- AlterTable
ALTER TABLE "design_reviews" ADD COLUMN "outcome" "DesignReviewOutcome";
