ALTER TABLE "accounts_payable_invoices"
  ADD COLUMN "invoiceDocumentKey" TEXT,
  ADD COLUMN "invoiceDocumentName" TEXT,
  ADD COLUMN "invoiceDocumentMimeType" TEXT,
  ADD COLUMN "invoiceDocumentSize" INTEGER;

CREATE UNIQUE INDEX "accounts_payable_invoices_invoiceDocumentKey_key"
  ON "accounts_payable_invoices"("invoiceDocumentKey");
