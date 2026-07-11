-- CreateEnum
CREATE TYPE "OrderConfirmationStatus" AS ENUM ('DRAFT', 'AWAITING_CUSTOMER_SIGNATURE', 'AWAITING_INTERNAL_SIGNATURE', 'REJECTED', 'EXECUTED');

-- CreateEnum
CREATE TYPE "OrderConfirmationDeliveryType" AS ENUM ('FULL_TRUCKLOAD', 'PARTIAL_TRUCKLOAD', 'CUSTOMER_PICKUP_EXWORKS', 'COURIER_EXPRESS', 'OTHER');

-- CreateEnum
CREATE TYPE "OrderConfirmationQualityReport" AS ENUM ('MATERIAL_TEST_CERTIFICATE', 'FACTORY_ACCEPTANCE_TEST_REPORT', 'CALIBRATION_CERTIFICATE', 'COMPLIANCE_CERTIFICATE', 'OTHER');

-- CreateTable
CREATE TABLE "order_confirmation_sheets" (
    "id" TEXT NOT NULL,
    "confirmationNumber" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "revisionNumber" INTEGER NOT NULL DEFAULT 1,
    "status" "OrderConfirmationStatus" NOT NULL DEFAULT 'DRAFT',
    "requirementsOverview" TEXT NOT NULL,
    "deliveryDate" TIMESTAMP(3) NOT NULL,
    "deliveryLocation" TEXT NOT NULL,
    "deliveryType" "OrderConfirmationDeliveryType" NOT NULL,
    "qualityReportsExpected" "OrderConfirmationQualityReport"[],
    "qualityReportNotes" TEXT,
    "installationCommissioningRequired" BOOLEAN NOT NULL DEFAULT false,
    "installationNotes" TEXT,
    "warrantyTerms" TEXT NOT NULL,
    "paymentMilestones" TEXT NOT NULL,
    "siteReadinessRequirements" TEXT,
    "specialHandlingInstructions" TEXT,
    "packagingType" TEXT NOT NULL,
    "protectiveMeasures" TEXT NOT NULL,
    "packagingComplianceStandard" TEXT,
    "labelingRequirements" TEXT NOT NULL,
    "customerPackagingSpecReference" TEXT,
    "customerContactName" TEXT NOT NULL,
    "customerContactPhone" TEXT NOT NULL,
    "customerContactEmail" TEXT NOT NULL,
    "pdfGeneratedAt" TIMESTAMP(3),
    "signedCopyStorageKey" TEXT,
    "signedCopyUploadedById" TEXT,
    "signedCopyUploadedAt" TIMESTAMP(3),
    "internalSignedById" TEXT,
    "internalSignedAt" TIMESTAMP(3),
    "internalReviewComments" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "order_confirmation_sheets_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "order_confirmation_sheets_confirmationNumber_key" ON "order_confirmation_sheets"("confirmationNumber");

-- CreateIndex
CREATE INDEX "order_confirmation_sheets_orderId_idx" ON "order_confirmation_sheets"("orderId");

-- CreateIndex
CREATE INDEX "order_confirmation_sheets_status_idx" ON "order_confirmation_sheets"("status");

-- AddForeignKey
ALTER TABLE "order_confirmation_sheets" ADD CONSTRAINT "order_confirmation_sheets_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_confirmation_sheets" ADD CONSTRAINT "order_confirmation_sheets_signedCopyUploadedById_fkey" FOREIGN KEY ("signedCopyUploadedById") REFERENCES "employees"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_confirmation_sheets" ADD CONSTRAINT "order_confirmation_sheets_internalSignedById_fkey" FOREIGN KEY ("internalSignedById") REFERENCES "employees"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_confirmation_sheets" ADD CONSTRAINT "order_confirmation_sheets_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

