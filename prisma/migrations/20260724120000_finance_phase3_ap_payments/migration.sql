-- CreateEnum
CREATE TYPE "PayablePartyType" AS ENUM ('SUPPLIER', 'VENDOR');

-- CreateEnum
CREATE TYPE "ApInvoiceStatus" AS ENUM ('DRAFT', 'PENDING_MATCH', 'MATCH_EXCEPTION', 'PENDING_APPROVAL', 'REJECTED', 'APPROVED', 'PARTIALLY_PAID', 'PAID', 'DISPUTED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ThreeWayMatchStatus" AS ENUM ('NOT_APPLICABLE', 'MATCHED', 'QUANTITY_MISMATCH', 'PRICE_MISMATCH', 'QUANTITY_AND_PRICE_MISMATCH');

-- CreateEnum
CREATE TYPE "ApPaymentStatus" AS ENUM ('DRAFT', 'PENDING_APPROVAL', 'REJECTED', 'APPROVED', 'EXECUTED', 'REVERSED');

-- CreateTable
CREATE TABLE "accounts_payable_invoices" (
    "id" TEXT NOT NULL,
    "internalBillNumber" TEXT NOT NULL,
    "partyType" "PayablePartyType" NOT NULL,
    "supplierId" TEXT,
    "vendorId" TEXT,
    "partyId" TEXT NOT NULL,
    "externalInvoiceNumber" TEXT NOT NULL,
    "invoiceDate" TIMESTAMP(3) NOT NULL,
    "receivedDate" TIMESTAMP(3) NOT NULL,
    "dueDate" TIMESTAMP(3) NOT NULL,
    "purchaseOrderId" TEXT,
    "currencyCode" VARCHAR(3) NOT NULL,
    "exchangeRateToInr" DECIMAL(18,6) NOT NULL DEFAULT 1,
    "supplierGstinSnapshot" TEXT,
    "taxableAmount" DECIMAL(18,2) NOT NULL,
    "inputCgstAmount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "inputSgstAmount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "inputIgstAmount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "otherCharges" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "tdsAmount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "totalAmount" DECIMAL(18,2) NOT NULL,
    "paidAmount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "outstandingAmount" DECIMAL(18,2) NOT NULL,
    "status" "ApInvoiceStatus" NOT NULL DEFAULT 'DRAFT',
    "matchStatus" "ThreeWayMatchStatus" NOT NULL DEFAULT 'NOT_APPLICABLE',
    "matchDetails" JSONB,
    "matchOverrideReason" TEXT,
    "paymentHold" BOOLEAN NOT NULL DEFAULT false,
    "paymentHoldReason" TEXT,
    "notes" TEXT,
    "createdById" TEXT NOT NULL,
    "submittedById" TEXT,
    "submittedAt" TIMESTAMP(3),
    "approvedById" TEXT,
    "approvedAt" TIMESTAMP(3),
    "rejectionComment" TEXT,
    "journalEntryId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "accounts_payable_invoices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "accounts_payable_invoice_lines" (
    "id" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "description" TEXT NOT NULL,
    "hsnSacCode" TEXT,
    "purchaseOrderLineId" TEXT,
    "grnLineId" TEXT,
    "quantity" DECIMAL(14,4) NOT NULL,
    "unitOfMeasure" TEXT NOT NULL,
    "unitPrice" DECIMAL(18,2) NOT NULL,
    "taxableAmount" DECIMAL(18,2) NOT NULL,
    "taxAmount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "lineTotal" DECIMAL(18,2) NOT NULL,

    CONSTRAINT "accounts_payable_invoice_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "accounts_payable_payments" (
    "id" TEXT NOT NULL,
    "paymentNumber" TEXT NOT NULL,
    "partyType" "PayablePartyType" NOT NULL,
    "supplierId" TEXT,
    "vendorId" TEXT,
    "partyId" TEXT NOT NULL,
    "plannedDate" TIMESTAMP(3) NOT NULL,
    "executedDate" TIMESTAMP(3),
    "currencyCode" VARCHAR(3) NOT NULL,
    "exchangeRateToInr" DECIMAL(18,6) NOT NULL DEFAULT 1,
    "amount" DECIMAL(18,2) NOT NULL,
    "paymentMethod" TEXT NOT NULL,
    "bankReference" TEXT,
    "notes" TEXT,
    "status" "ApPaymentStatus" NOT NULL DEFAULT 'DRAFT',
    "createdById" TEXT NOT NULL,
    "submittedById" TEXT,
    "submittedAt" TIMESTAMP(3),
    "approvedById" TEXT,
    "approvedAt" TIMESTAMP(3),
    "rejectionComment" TEXT,
    "journalEntryId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "accounts_payable_payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ap_payment_allocations" (
    "id" TEXT NOT NULL,
    "paymentId" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ap_payment_allocations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "accounts_payable_invoices_internalBillNumber_key" ON "accounts_payable_invoices"("internalBillNumber");

-- CreateIndex
CREATE UNIQUE INDEX "accounts_payable_invoices_journalEntryId_key" ON "accounts_payable_invoices"("journalEntryId");

-- CreateIndex
CREATE INDEX "accounts_payable_invoices_partyType_partyId_dueDate_status_idx" ON "accounts_payable_invoices"("partyType", "partyId", "dueDate", "status");

-- CreateIndex
CREATE INDEX "accounts_payable_invoices_purchaseOrderId_idx" ON "accounts_payable_invoices"("purchaseOrderId");

-- CreateIndex
CREATE UNIQUE INDEX "accounts_payable_invoices_partyType_partyId_externalInvoice_key" ON "accounts_payable_invoices"("partyType", "partyId", "externalInvoiceNumber");

-- CreateIndex
CREATE INDEX "accounts_payable_invoice_lines_purchaseOrderLineId_idx" ON "accounts_payable_invoice_lines"("purchaseOrderLineId");

-- CreateIndex
CREATE INDEX "accounts_payable_invoice_lines_grnLineId_idx" ON "accounts_payable_invoice_lines"("grnLineId");

-- CreateIndex
CREATE UNIQUE INDEX "accounts_payable_invoice_lines_invoiceId_sequence_key" ON "accounts_payable_invoice_lines"("invoiceId", "sequence");

-- CreateIndex
CREATE UNIQUE INDEX "accounts_payable_payments_paymentNumber_key" ON "accounts_payable_payments"("paymentNumber");

-- CreateIndex
CREATE UNIQUE INDEX "accounts_payable_payments_journalEntryId_key" ON "accounts_payable_payments"("journalEntryId");

-- CreateIndex
CREATE INDEX "accounts_payable_payments_partyType_partyId_plannedDate_sta_idx" ON "accounts_payable_payments"("partyType", "partyId", "plannedDate", "status");

-- CreateIndex
CREATE INDEX "ap_payment_allocations_invoiceId_idx" ON "ap_payment_allocations"("invoiceId");

-- CreateIndex
CREATE UNIQUE INDEX "ap_payment_allocations_paymentId_invoiceId_key" ON "ap_payment_allocations"("paymentId", "invoiceId");

-- AddForeignKey
ALTER TABLE "accounts_payable_invoices" ADD CONSTRAINT "accounts_payable_invoices_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "suppliers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accounts_payable_invoices" ADD CONSTRAINT "accounts_payable_invoices_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "vendors"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accounts_payable_invoices" ADD CONSTRAINT "accounts_payable_invoices_purchaseOrderId_fkey" FOREIGN KEY ("purchaseOrderId") REFERENCES "purchase_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accounts_payable_invoices" ADD CONSTRAINT "accounts_payable_invoices_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accounts_payable_invoices" ADD CONSTRAINT "accounts_payable_invoices_submittedById_fkey" FOREIGN KEY ("submittedById") REFERENCES "employees"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accounts_payable_invoices" ADD CONSTRAINT "accounts_payable_invoices_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "employees"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accounts_payable_invoices" ADD CONSTRAINT "accounts_payable_invoices_journalEntryId_fkey" FOREIGN KEY ("journalEntryId") REFERENCES "journal_entries"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accounts_payable_invoice_lines" ADD CONSTRAINT "accounts_payable_invoice_lines_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "accounts_payable_invoices"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accounts_payable_invoice_lines" ADD CONSTRAINT "accounts_payable_invoice_lines_purchaseOrderLineId_fkey" FOREIGN KEY ("purchaseOrderLineId") REFERENCES "purchase_order_lines"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accounts_payable_invoice_lines" ADD CONSTRAINT "accounts_payable_invoice_lines_grnLineId_fkey" FOREIGN KEY ("grnLineId") REFERENCES "goods_receipt_note_lines"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accounts_payable_payments" ADD CONSTRAINT "accounts_payable_payments_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "suppliers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accounts_payable_payments" ADD CONSTRAINT "accounts_payable_payments_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "vendors"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accounts_payable_payments" ADD CONSTRAINT "accounts_payable_payments_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accounts_payable_payments" ADD CONSTRAINT "accounts_payable_payments_submittedById_fkey" FOREIGN KEY ("submittedById") REFERENCES "employees"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accounts_payable_payments" ADD CONSTRAINT "accounts_payable_payments_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "employees"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accounts_payable_payments" ADD CONSTRAINT "accounts_payable_payments_journalEntryId_fkey" FOREIGN KEY ("journalEntryId") REFERENCES "journal_entries"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ap_payment_allocations" ADD CONSTRAINT "ap_payment_allocations_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "accounts_payable_payments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ap_payment_allocations" ADD CONSTRAINT "ap_payment_allocations_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "accounts_payable_invoices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
