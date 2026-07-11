-- CreateEnum
CREATE TYPE "SignatureFont" AS ENUM ('DANCING_SCRIPT', 'CAVEAT', 'PACIFICO', 'GREAT_VIBES');

-- AlterTable
ALTER TABLE "bid_decision_assessments" ADD COLUMN     "approverSignatureFontSnapshot" "SignatureFont",
ADD COLUMN     "approverSignatureTextSnapshot" TEXT;

-- AlterTable
ALTER TABLE "bids" ADD COLUMN     "approverSignatureFontSnapshot" "SignatureFont",
ADD COLUMN     "approverSignatureTextSnapshot" TEXT;

-- AlterTable
ALTER TABLE "employees" ADD COLUMN     "signatureFont" "SignatureFont",
ADD COLUMN     "signatureText" TEXT;

-- AlterTable
ALTER TABLE "leave_requests" ADD COLUMN     "approverSignatureFontSnapshot" "SignatureFont",
ADD COLUMN     "approverSignatureTextSnapshot" TEXT;

-- AlterTable
ALTER TABLE "order_confirmation_sheets" ADD COLUMN     "approverSignatureFontSnapshot" "SignatureFont",
ADD COLUMN     "approverSignatureTextSnapshot" TEXT;

