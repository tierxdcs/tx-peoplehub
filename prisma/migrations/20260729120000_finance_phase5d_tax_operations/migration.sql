ALTER TABLE "finance_company_settings" ADD COLUMN "pan" TEXT, ADD COLUMN "tan" TEXT;
ALTER TABLE "accounts_payable_invoices" ADD COLUMN "tdsSectionCode" TEXT, ADD COLUMN "tdsRatePercent" DECIMAL(5,2), ADD COLUMN "tdsTaxableBase" DECIMAL(18,2);

CREATE TABLE "tax_party_profiles" (
  "id" TEXT NOT NULL, "partyType" "PayablePartyType" NOT NULL, "partyId" TEXT NOT NULL,
  "legalName" TEXT NOT NULL, "pan" TEXT NOT NULL, "tan" TEXT, "residentialStatus" TEXT NOT NULL DEFAULT 'RESIDENT',
  "lowerDeductionCertificateNo" TEXT, "lowerDeductionRate" DECIMAL(5,2), "certificateValidUntil" TIMESTAMP(3),
  "isActive" BOOLEAN NOT NULL DEFAULT true, "createdById" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "tax_party_profiles_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "tax_party_profiles_partyType_partyId_key" ON "tax_party_profiles"("partyType", "partyId");
CREATE INDEX "tax_party_profiles_pan_isActive_idx" ON "tax_party_profiles"("pan", "isActive");

CREATE TABLE "tds_challans" (
  "id" TEXT NOT NULL, "challanNumber" TEXT NOT NULL, "bsrCode" TEXT NOT NULL, "challanSerialNo" TEXT NOT NULL,
  "depositDate" TIMESTAMP(3) NOT NULL, "financialYear" TEXT NOT NULL, "sectionCode" TEXT NOT NULL,
  "taxAmount" DECIMAL(18,2) NOT NULL, "interestAmount" DECIMAL(18,2) NOT NULL DEFAULT 0,
  "feeAmount" DECIMAL(18,2) NOT NULL DEFAULT 0, "totalAmount" DECIMAL(18,2) NOT NULL,
  "createdById" TEXT NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "tds_challans_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "tds_challans_challanNumber_key" ON "tds_challans"("challanNumber");
CREATE UNIQUE INDEX "tds_challans_bsrCode_depositDate_challanSerialNo_key" ON "tds_challans"("bsrCode", "depositDate", "challanSerialNo");
CREATE INDEX "tds_challans_financialYear_sectionCode_idx" ON "tds_challans"("financialYear", "sectionCode");

CREATE TABLE "tds_challan_allocations" (
  "id" TEXT NOT NULL, "challanId" TEXT NOT NULL, "tdsReturnId" TEXT NOT NULL, "amount" DECIMAL(18,2) NOT NULL,
  "createdById" TEXT NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "tds_challan_allocations_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "tds_challan_allocations_challanId_tdsReturnId_key" ON "tds_challan_allocations"("challanId", "tdsReturnId");
CREATE INDEX "tds_challan_allocations_tdsReturnId_idx" ON "tds_challan_allocations"("tdsReturnId");
ALTER TABLE "tds_challan_allocations" ADD CONSTRAINT "tds_challan_allocations_challanId_fkey" FOREIGN KEY ("challanId") REFERENCES "tds_challans"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "tds_challan_allocations" ADD CONSTRAINT "tds_challan_allocations_tdsReturnId_fkey" FOREIGN KEY ("tdsReturnId") REFERENCES "tds_returns"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "compliance_evidence" (
  "id" TEXT NOT NULL, "gstReturnId" TEXT, "tdsReturnId" TEXT, "evidenceType" TEXT NOT NULL,
  "fileName" TEXT NOT NULL, "contentType" TEXT NOT NULL, "storageKey" TEXT NOT NULL, "sizeBytes" INTEGER,
  "confirmedAt" TIMESTAMP(3), "uploadedById" TEXT NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "compliance_evidence_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "compliance_evidence_storageKey_key" ON "compliance_evidence"("storageKey");
CREATE INDEX "compliance_evidence_gstReturnId_idx" ON "compliance_evidence"("gstReturnId");
CREATE INDEX "compliance_evidence_tdsReturnId_idx" ON "compliance_evidence"("tdsReturnId");
ALTER TABLE "compliance_evidence" ADD CONSTRAINT "compliance_evidence_gstReturnId_fkey" FOREIGN KEY ("gstReturnId") REFERENCES "gst_returns"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "compliance_evidence" ADD CONSTRAINT "compliance_evidence_tdsReturnId_fkey" FOREIGN KEY ("tdsReturnId") REFERENCES "tds_returns"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "compliance_due_dates" (
  "id" TEXT NOT NULL, "obligation" TEXT NOT NULL, "taxPeriod" TEXT NOT NULL, "dueDate" TIMESTAMP(3) NOT NULL,
  "reminderDays" INTEGER NOT NULL DEFAULT 5, "completedAt" TIMESTAMP(3), "completedReference" TEXT,
  "createdById" TEXT NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "compliance_due_dates_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "compliance_due_dates_obligation_taxPeriod_key" ON "compliance_due_dates"("obligation", "taxPeriod");
CREATE INDEX "compliance_due_dates_dueDate_completedAt_idx" ON "compliance_due_dates"("dueDate", "completedAt");
