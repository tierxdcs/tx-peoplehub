CREATE TYPE "BillingMilestoneStatus" AS ENUM ('PLANNED','READY_TO_INVOICE','INVOICED','CANCELLED');
CREATE TYPE "SalesInvoiceStatus" AS ENUM ('DRAFT','PENDING_APPROVAL','REJECTED','GST_PENDING','ISSUED','PARTIALLY_PAID','PAID','OVERDUE','CANCELLED');
CREATE TYPE "ReceiptStatus" AS ENUM ('DRAFT','PENDING_APPROVAL','REJECTED','POSTED','REVERSED');
CREATE TYPE "GstDocumentType" AS ENUM ('TAX_INVOICE','EWAY_BILL');
CREATE TYPE "GstSubmissionStatus" AS ENUM ('PENDING','PROCESSING','SUCCEEDED','FAILED','CANCELLED');

CREATE TABLE "finance_company_settings" (
  "id" TEXT NOT NULL DEFAULT 'INDIA', "legalName" TEXT NOT NULL, "gstin" TEXT NOT NULL,
  "addressLine1" TEXT NOT NULL, "addressLine2" TEXT, "city" TEXT NOT NULL,
  "state" TEXT NOT NULL, "stateCode" TEXT NOT NULL, "postalCode" TEXT NOT NULL,
  "eInvoiceEnabled" BOOLEAN NOT NULL DEFAULT true, "eWayBillEnabled" BOOLEAN NOT NULL DEFAULT true,
  "updatedAt" TIMESTAMP(3) NOT NULL, CONSTRAINT "finance_company_settings_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "billing_milestones" (
  "id" TEXT NOT NULL, "orderId" TEXT NOT NULL, "name" TEXT NOT NULL, "description" TEXT,
  "percentage" DECIMAL(5,2), "fixedAmount" DECIMAL(18,2), "plannedDate" TIMESTAMP(3),
  "achievedAt" TIMESTAMP(3), "status" "BillingMilestoneStatus" NOT NULL DEFAULT 'PLANNED',
  "sequence" INTEGER NOT NULL DEFAULT 0, "createdById" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "billing_milestones_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "billing_milestones_value_check" CHECK (("percentage" IS NOT NULL) <> ("fixedAmount" IS NOT NULL))
);
CREATE INDEX "billing_milestones_orderId_status_idx" ON "billing_milestones"("orderId","status");

CREATE TABLE "sales_invoices" (
  "id" TEXT NOT NULL, "invoiceNumber" TEXT NOT NULL, "invoiceDate" TIMESTAMP(3) NOT NULL,
  "dueDate" TIMESTAMP(3) NOT NULL, "customerId" TEXT NOT NULL, "orderId" TEXT, "milestoneId" TEXT,
  "customerPoReference" TEXT, "currencyCode" VARCHAR(3) NOT NULL, "exchangeRateToInr" DECIMAL(18,6) NOT NULL DEFAULT 1,
  "billingAddressSnapshot" JSONB NOT NULL, "shippingAddressSnapshot" JSONB, "customerGstinSnapshot" TEXT,
  "placeOfSupplyState" TEXT NOT NULL, "placeOfSupplyStateCode" TEXT NOT NULL,
  "status" "SalesInvoiceStatus" NOT NULL DEFAULT 'DRAFT', "subtotal" DECIMAL(18,2) NOT NULL,
  "discountAmount" DECIMAL(18,2) NOT NULL DEFAULT 0, "taxableAmount" DECIMAL(18,2) NOT NULL,
  "cgstAmount" DECIMAL(18,2) NOT NULL DEFAULT 0, "sgstAmount" DECIMAL(18,2) NOT NULL DEFAULT 0,
  "igstAmount" DECIMAL(18,2) NOT NULL DEFAULT 0, "otherCharges" DECIMAL(18,2) NOT NULL DEFAULT 0,
  "roundOff" DECIMAL(18,2) NOT NULL DEFAULT 0, "totalAmount" DECIMAL(18,2) NOT NULL,
  "paidAmount" DECIMAL(18,2) NOT NULL DEFAULT 0, "outstandingAmount" DECIMAL(18,2) NOT NULL,
  "paymentTerms" TEXT, "createdById" TEXT NOT NULL, "submittedById" TEXT, "submittedAt" TIMESTAMP(3),
  "approvedById" TEXT, "approvedAt" TIMESTAMP(3), "rejectionComment" TEXT, "issuedAt" TIMESTAMP(3),
  "journalEntryId" TEXT, "irn" TEXT, "irnAcknowledgementNumber" TEXT, "irnAcknowledgementDate" TIMESTAMP(3),
  "signedQrCode" TEXT, "eWayBillNumber" TEXT, "eWayBillGeneratedAt" TIMESTAMP(3), "eWayBillValidUntil" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "sales_invoices_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "sales_invoices_amounts_check" CHECK ("totalAmount" >= 0 AND "paidAmount" >= 0 AND "outstandingAmount" >= 0)
);
CREATE UNIQUE INDEX "sales_invoices_invoiceNumber_key" ON "sales_invoices"("invoiceNumber");
CREATE UNIQUE INDEX "sales_invoices_journalEntryId_key" ON "sales_invoices"("journalEntryId");
CREATE UNIQUE INDEX "sales_invoices_irn_key" ON "sales_invoices"("irn");
CREATE UNIQUE INDEX "sales_invoices_eWayBillNumber_key" ON "sales_invoices"("eWayBillNumber");
CREATE INDEX "sales_invoices_customerId_dueDate_status_idx" ON "sales_invoices"("customerId","dueDate","status");
CREATE INDEX "sales_invoices_orderId_idx" ON "sales_invoices"("orderId");

CREATE TABLE "sales_invoice_lines" (
  "id" TEXT NOT NULL, "invoiceId" TEXT NOT NULL, "sequence" INTEGER NOT NULL, "productId" TEXT,
  "description" TEXT NOT NULL, "hsnSacCode" TEXT NOT NULL, "quantity" DECIMAL(14,4) NOT NULL,
  "unitOfMeasure" TEXT NOT NULL, "unitPrice" DECIMAL(18,2) NOT NULL,
  "discountPercent" DECIMAL(5,2) NOT NULL DEFAULT 0, "taxableAmount" DECIMAL(18,2) NOT NULL,
  "cgstRate" DECIMAL(5,2) NOT NULL DEFAULT 0, "cgstAmount" DECIMAL(18,2) NOT NULL DEFAULT 0,
  "sgstRate" DECIMAL(5,2) NOT NULL DEFAULT 0, "sgstAmount" DECIMAL(18,2) NOT NULL DEFAULT 0,
  "igstRate" DECIMAL(5,2) NOT NULL DEFAULT 0, "igstAmount" DECIMAL(18,2) NOT NULL DEFAULT 0,
  "lineTotal" DECIMAL(18,2) NOT NULL, CONSTRAINT "sales_invoice_lines_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "sales_invoice_lines_invoiceId_sequence_key" ON "sales_invoice_lines"("invoiceId","sequence");
CREATE INDEX "sales_invoice_lines_productId_idx" ON "sales_invoice_lines"("productId");

CREATE TABLE "customer_receipts" (
  "id" TEXT NOT NULL, "receiptNumber" TEXT NOT NULL, "receiptDate" TIMESTAMP(3) NOT NULL,
  "customerId" TEXT NOT NULL, "currencyCode" VARCHAR(3) NOT NULL, "exchangeRateToInr" DECIMAL(18,6) NOT NULL DEFAULT 1,
  "amount" DECIMAL(18,2) NOT NULL, "tdsDeducted" DECIMAL(18,2) NOT NULL DEFAULT 0,
  "bankCharges" DECIMAL(18,2) NOT NULL DEFAULT 0, "unappliedAmount" DECIMAL(18,2) NOT NULL,
  "paymentMethod" TEXT NOT NULL, "bankReference" TEXT NOT NULL, "notes" TEXT,
  "status" "ReceiptStatus" NOT NULL DEFAULT 'DRAFT', "createdById" TEXT NOT NULL,
  "submittedById" TEXT, "submittedAt" TIMESTAMP(3), "approvedById" TEXT, "approvedAt" TIMESTAMP(3),
  "rejectionComment" TEXT, "journalEntryId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "customer_receipts_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "customer_receipts_amounts_check" CHECK ("amount" > 0 AND "tdsDeducted" >= 0 AND "bankCharges" >= 0 AND "unappliedAmount" >= 0)
);
CREATE UNIQUE INDEX "customer_receipts_receiptNumber_key" ON "customer_receipts"("receiptNumber");
CREATE UNIQUE INDEX "customer_receipts_journalEntryId_key" ON "customer_receipts"("journalEntryId");
CREATE INDEX "customer_receipts_customerId_receiptDate_idx" ON "customer_receipts"("customerId","receiptDate");

CREATE TABLE "receipt_allocations" (
  "id" TEXT NOT NULL, "receiptId" TEXT NOT NULL, "invoiceId" TEXT NOT NULL, "amount" DECIMAL(18,2) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, CONSTRAINT "receipt_allocations_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "receipt_allocations_amount_check" CHECK ("amount" > 0)
);
CREATE UNIQUE INDEX "receipt_allocations_receiptId_invoiceId_key" ON "receipt_allocations"("receiptId","invoiceId");
CREATE INDEX "receipt_allocations_invoiceId_idx" ON "receipt_allocations"("invoiceId");

CREATE TABLE "gst_submissions" (
  "id" TEXT NOT NULL, "documentType" "GstDocumentType" NOT NULL,
  "status" "GstSubmissionStatus" NOT NULL DEFAULT 'PENDING', "invoiceId" TEXT NOT NULL,
  "idempotencyKey" TEXT NOT NULL, "requestPayload" JSONB NOT NULL, "responsePayload" JSONB,
  "attemptCount" INTEGER NOT NULL DEFAULT 0, "lastAttemptAt" TIMESTAMP(3), "errorCode" TEXT, "errorMessage" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "gst_submissions_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "gst_submissions_idempotencyKey_key" ON "gst_submissions"("idempotencyKey");
CREATE INDEX "gst_submissions_status_createdAt_idx" ON "gst_submissions"("status","createdAt");

ALTER TABLE "billing_milestones" ADD CONSTRAINT "billing_milestones_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "billing_milestones" ADD CONSTRAINT "billing_milestones_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "sales_invoices" ADD CONSTRAINT "sales_invoices_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "sales_invoices" ADD CONSTRAINT "sales_invoices_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "sales_invoices" ADD CONSTRAINT "sales_invoices_milestoneId_fkey" FOREIGN KEY ("milestoneId") REFERENCES "billing_milestones"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "sales_invoices" ADD CONSTRAINT "sales_invoices_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "sales_invoices" ADD CONSTRAINT "sales_invoices_submittedById_fkey" FOREIGN KEY ("submittedById") REFERENCES "employees"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "sales_invoices" ADD CONSTRAINT "sales_invoices_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "employees"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "sales_invoices" ADD CONSTRAINT "sales_invoices_journalEntryId_fkey" FOREIGN KEY ("journalEntryId") REFERENCES "journal_entries"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "sales_invoice_lines" ADD CONSTRAINT "sales_invoice_lines_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "sales_invoices"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "sales_invoice_lines" ADD CONSTRAINT "sales_invoice_lines_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "customer_receipts" ADD CONSTRAINT "customer_receipts_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "customer_receipts" ADD CONSTRAINT "customer_receipts_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "customer_receipts" ADD CONSTRAINT "customer_receipts_submittedById_fkey" FOREIGN KEY ("submittedById") REFERENCES "employees"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "customer_receipts" ADD CONSTRAINT "customer_receipts_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "employees"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "customer_receipts" ADD CONSTRAINT "customer_receipts_journalEntryId_fkey" FOREIGN KEY ("journalEntryId") REFERENCES "journal_entries"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "receipt_allocations" ADD CONSTRAINT "receipt_allocations_receiptId_fkey" FOREIGN KEY ("receiptId") REFERENCES "customer_receipts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "receipt_allocations" ADD CONSTRAINT "receipt_allocations_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "sales_invoices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "gst_submissions" ADD CONSTRAINT "gst_submissions_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "sales_invoices"("id") ON DELETE CASCADE ON UPDATE CASCADE;
