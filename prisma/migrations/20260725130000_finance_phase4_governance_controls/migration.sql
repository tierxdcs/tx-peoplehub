DROP INDEX "tds_sections_sectionCode_key";
CREATE UNIQUE INDEX "tds_sections_sectionCode_effectiveFrom_key" ON "tds_sections"("sectionCode", "effectiveFrom");

CREATE INDEX "accounts_payable_invoices_itcStatus_invoiceDate_idx" ON "accounts_payable_invoices"("itcStatus", "invoiceDate");

ALTER TABLE "accounts_payable_invoices"
  ADD CONSTRAINT "accounts_payable_invoices_itcReconciledById_fkey"
  FOREIGN KEY ("itcReconciledById") REFERENCES "employees"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
