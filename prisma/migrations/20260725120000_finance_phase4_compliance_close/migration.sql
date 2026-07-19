CREATE TYPE "GstItcStatus" AS ENUM ('PENDING_RECONCILIATION', 'MATCHED_GSTR2B', 'MISMATCHED', 'INELIGIBLE', 'DEFERRED');
CREATE TYPE "FinanceNoteSide" AS ENUM ('ACCOUNTS_RECEIVABLE', 'ACCOUNTS_PAYABLE');
CREATE TYPE "FinanceNoteType" AS ENUM ('CREDIT_NOTE', 'DEBIT_NOTE');
CREATE TYPE "FinanceNoteStatus" AS ENUM ('DRAFT', 'PENDING_APPROVAL', 'REJECTED', 'POSTED', 'CANCELLED');
CREATE TYPE "PeriodCloseStatus" AS ENUM ('PREPARING', 'PENDING_APPROVAL', 'REJECTED', 'COMPLETED');

ALTER TABLE "accounts_payable_invoices"
  ADD COLUMN "itcReconciledAt" TIMESTAMP(3),
  ADD COLUMN "itcReconciledById" TEXT,
  ADD COLUMN "itcReconciliationNote" TEXT,
  ADD COLUMN "itcStatus" "GstItcStatus" NOT NULL DEFAULT 'PENDING_RECONCILIATION';

CREATE TABLE "tds_sections" (
  "id" TEXT NOT NULL,
  "sectionCode" TEXT NOT NULL,
  "description" TEXT NOT NULL,
  "ratePercent" DECIMAL(5,2) NOT NULL,
  "thresholdInr" DECIMAL(18,2) NOT NULL DEFAULT 0,
  "effectiveFrom" TIMESTAMP(3) NOT NULL,
  "effectiveTo" TIMESTAMP(3),
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdById" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "tds_sections_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "tds_section_values_check" CHECK ("ratePercent" >= 0 AND "ratePercent" <= 100 AND "thresholdInr" >= 0 AND ("effectiveTo" IS NULL OR "effectiveTo" >= "effectiveFrom"))
);

CREATE TABLE "finance_adjustment_notes" (
  "id" TEXT NOT NULL,
  "noteNumber" TEXT NOT NULL,
  "side" "FinanceNoteSide" NOT NULL,
  "noteType" "FinanceNoteType" NOT NULL,
  "noteDate" TIMESTAMP(3) NOT NULL,
  "reason" TEXT NOT NULL,
  "salesInvoiceId" TEXT,
  "apInvoiceId" TEXT,
  "taxableAmount" DECIMAL(18,2) NOT NULL,
  "cgstAmount" DECIMAL(18,2) NOT NULL DEFAULT 0,
  "sgstAmount" DECIMAL(18,2) NOT NULL DEFAULT 0,
  "igstAmount" DECIMAL(18,2) NOT NULL DEFAULT 0,
  "totalAmount" DECIMAL(18,2) NOT NULL,
  "status" "FinanceNoteStatus" NOT NULL DEFAULT 'DRAFT',
  "createdById" TEXT NOT NULL,
  "submittedById" TEXT,
  "submittedAt" TIMESTAMP(3),
  "approvedById" TEXT,
  "approvedAt" TIMESTAMP(3),
  "rejectionComment" TEXT,
  "journalEntryId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "finance_adjustment_notes_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "finance_note_exactly_one_invoice_check" CHECK (("side" = 'ACCOUNTS_RECEIVABLE' AND "salesInvoiceId" IS NOT NULL AND "apInvoiceId" IS NULL) OR ("side" = 'ACCOUNTS_PAYABLE' AND "apInvoiceId" IS NOT NULL AND "salesInvoiceId" IS NULL)),
  CONSTRAINT "finance_note_amounts_check" CHECK ("taxableAmount" >= 0 AND "cgstAmount" >= 0 AND "sgstAmount" >= 0 AND "igstAmount" >= 0 AND "totalAmount" = "taxableAmount" + "cgstAmount" + "sgstAmount" + "igstAmount" AND "totalAmount" > 0)
);

CREATE TABLE "period_closes" (
  "id" TEXT NOT NULL,
  "periodId" TEXT NOT NULL,
  "status" "PeriodCloseStatus" NOT NULL DEFAULT 'PREPARING',
  "checklist" JSONB NOT NULL,
  "preparationNote" TEXT,
  "preparedById" TEXT NOT NULL,
  "submittedAt" TIMESTAMP(3),
  "approvedById" TEXT,
  "approvedAt" TIMESTAMP(3),
  "rejectionComment" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "period_closes_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "tds_sections_sectionCode_key" ON "tds_sections"("sectionCode");
CREATE INDEX "tds_sections_isActive_effectiveFrom_idx" ON "tds_sections"("isActive", "effectiveFrom");
CREATE UNIQUE INDEX "finance_adjustment_notes_noteNumber_key" ON "finance_adjustment_notes"("noteNumber");
CREATE UNIQUE INDEX "finance_adjustment_notes_journalEntryId_key" ON "finance_adjustment_notes"("journalEntryId");
CREATE INDEX "finance_adjustment_notes_side_noteType_noteDate_idx" ON "finance_adjustment_notes"("side", "noteType", "noteDate");
CREATE INDEX "finance_adjustment_notes_salesInvoiceId_idx" ON "finance_adjustment_notes"("salesInvoiceId");
CREATE INDEX "finance_adjustment_notes_apInvoiceId_idx" ON "finance_adjustment_notes"("apInvoiceId");
CREATE UNIQUE INDEX "period_closes_periodId_key" ON "period_closes"("periodId");
CREATE INDEX "period_closes_status_idx" ON "period_closes"("status");

ALTER TABLE "tds_sections" ADD CONSTRAINT "tds_sections_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "finance_adjustment_notes" ADD CONSTRAINT "finance_adjustment_notes_salesInvoiceId_fkey" FOREIGN KEY ("salesInvoiceId") REFERENCES "sales_invoices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "finance_adjustment_notes" ADD CONSTRAINT "finance_adjustment_notes_apInvoiceId_fkey" FOREIGN KEY ("apInvoiceId") REFERENCES "accounts_payable_invoices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "finance_adjustment_notes" ADD CONSTRAINT "finance_adjustment_notes_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "finance_adjustment_notes" ADD CONSTRAINT "finance_adjustment_notes_submittedById_fkey" FOREIGN KEY ("submittedById") REFERENCES "employees"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "finance_adjustment_notes" ADD CONSTRAINT "finance_adjustment_notes_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "employees"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "finance_adjustment_notes" ADD CONSTRAINT "finance_adjustment_notes_journalEntryId_fkey" FOREIGN KEY ("journalEntryId") REFERENCES "journal_entries"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "period_closes" ADD CONSTRAINT "period_closes_periodId_fkey" FOREIGN KEY ("periodId") REFERENCES "accounting_periods"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "period_closes" ADD CONSTRAINT "period_closes_preparedById_fkey" FOREIGN KEY ("preparedById") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "period_closes" ADD CONSTRAINT "period_closes_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "employees"("id") ON DELETE SET NULL ON UPDATE CASCADE;
