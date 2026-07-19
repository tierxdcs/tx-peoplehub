CREATE TYPE "ComplianceReturnStatus" AS ENUM ('DRAFT', 'PREPARED', 'PENDING_APPROVAL', 'APPROVED', 'SUBMITTED', 'FILED', 'FAILED');
CREATE TYPE "GstReturnType" AS ENUM ('GSTR1', 'GSTR3B');
CREATE TYPE "Gstr2bMatchStatus" AS ENUM ('UNMATCHED', 'MATCHED', 'MISMATCHED', 'IGNORED');
CREATE TYPE "TdsReturnQuarter" AS ENUM ('Q1', 'Q2', 'Q3', 'Q4');

CREATE TABLE "gst_returns" (
  "id" TEXT NOT NULL, "returnType" "GstReturnType" NOT NULL,
  "financialYear" TEXT NOT NULL, "taxPeriod" TEXT NOT NULL,
  "status" "ComplianceReturnStatus" NOT NULL DEFAULT 'DRAFT',
  "summary" JSONB, "payload" JSONB, "preparedById" TEXT, "preparedAt" TIMESTAMP(3),
  "submittedById" TEXT, "submittedAt" TIMESTAMP(3), "approvedById" TEXT, "approvedAt" TIMESTAMP(3),
  "filedAt" TIMESTAMP(3), "arn" TEXT, "providerReference" TEXT, "acknowledgementData" JSONB,
  "errorMessage" TEXT, "attemptCount" INTEGER NOT NULL DEFAULT 0, "lastAttemptAt" TIMESTAMP(3),
  "createdById" TEXT NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL, CONSTRAINT "gst_returns_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "gst_returns_returnType_taxPeriod_key" ON "gst_returns"("returnType", "taxPeriod");
CREATE INDEX "gst_returns_status_taxPeriod_idx" ON "gst_returns"("status", "taxPeriod");

CREATE TABLE "gstr2b_lines" (
  "id" TEXT NOT NULL, "taxPeriod" TEXT NOT NULL, "sourceChecksum" TEXT NOT NULL,
  "supplierGstin" TEXT NOT NULL, "supplierName" TEXT, "invoiceNumber" TEXT NOT NULL,
  "invoiceDate" TIMESTAMP(3) NOT NULL, "taxableAmount" DECIMAL(18,2) NOT NULL,
  "cgstAmount" DECIMAL(18,2) NOT NULL DEFAULT 0, "sgstAmount" DECIMAL(18,2) NOT NULL DEFAULT 0,
  "igstAmount" DECIMAL(18,2) NOT NULL DEFAULT 0, "cessAmount" DECIMAL(18,2) NOT NULL DEFAULT 0,
  "itcAvailable" BOOLEAN NOT NULL DEFAULT true, "matchStatus" "Gstr2bMatchStatus" NOT NULL DEFAULT 'UNMATCHED',
  "matchedApInvoiceId" TEXT, "mismatchReason" TEXT, "importedById" TEXT NOT NULL,
  "importedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "reconciledById" TEXT, "reconciledAt" TIMESTAMP(3),
  CONSTRAINT "gstr2b_lines_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "gstr2b_lines_taxPeriod_sourceChecksum_key" ON "gstr2b_lines"("taxPeriod", "sourceChecksum");
CREATE INDEX "gstr2b_lines_taxPeriod_matchStatus_idx" ON "gstr2b_lines"("taxPeriod", "matchStatus");
CREATE INDEX "gstr2b_lines_supplierGstin_invoiceNumber_idx" ON "gstr2b_lines"("supplierGstin", "invoiceNumber");

CREATE TABLE "tds_returns" (
  "id" TEXT NOT NULL, "financialYear" TEXT NOT NULL, "quarter" "TdsReturnQuarter" NOT NULL,
  "formType" TEXT NOT NULL DEFAULT '26Q', "status" "ComplianceReturnStatus" NOT NULL DEFAULT 'DRAFT',
  "summary" JSONB, "payload" JSONB, "challanDetails" JSONB, "preparedById" TEXT, "preparedAt" TIMESTAMP(3),
  "submittedById" TEXT, "submittedAt" TIMESTAMP(3), "approvedById" TEXT, "approvedAt" TIMESTAMP(3),
  "filedAt" TIMESTAMP(3), "acknowledgementNo" TEXT, "form16aEvidence" JSONB, "errorMessage" TEXT,
  "createdById" TEXT NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL, CONSTRAINT "tds_returns_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "tds_returns_financialYear_quarter_formType_key" ON "tds_returns"("financialYear", "quarter", "formType");
CREATE INDEX "tds_returns_status_financialYear_idx" ON "tds_returns"("status", "financialYear");
