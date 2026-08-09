-- Offer-letter approval gate: status lifecycle, frozen snapshot, and the
-- vertical-owner approver decision fields.

-- CreateEnum
CREATE TYPE "OfferLetterStatus" AS ENUM ('DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'REJECTED');

-- AlterTable
ALTER TABLE "offer_letters"
    ADD COLUMN "status" "OfferLetterStatus" NOT NULL DEFAULT 'DRAFT',
    ADD COLUMN "snapshotData" JSONB,
    ADD COLUMN "approverId" TEXT,
    ADD COLUMN "submittedAt" TIMESTAMP(3),
    ADD COLUMN "decidedAt" TIMESTAMP(3),
    ADD COLUMN "approverComments" TEXT;

-- CreateIndex
CREATE INDEX "offer_letters_status_approverId_idx" ON "offer_letters"("status", "approverId");

-- AddForeignKey
ALTER TABLE "offer_letters" ADD CONSTRAINT "offer_letters_approverId_fkey"
FOREIGN KEY ("approverId") REFERENCES "employees"("id") ON DELETE SET NULL ON UPDATE CASCADE;
