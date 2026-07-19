CREATE TYPE "BankStatementStatus" AS ENUM ('DRAFT', 'PENDING_APPROVAL', 'REJECTED', 'APPROVED');
CREATE TYPE "BankLineResolution" AS ENUM ('PENDING', 'MATCHED', 'UNMATCHED_ACCEPTED');
CREATE TYPE "BankMatchType" AS ENUM ('CUSTOMER_RECEIPT', 'VENDOR_PAYMENT', 'JOURNAL_ENTRY');

CREATE TABLE "finance_bank_accounts" (
  "id" TEXT NOT NULL,
  "accountName" TEXT NOT NULL,
  "bankName" TEXT NOT NULL,
  "accountNumberLast4" VARCHAR(4) NOT NULL,
  "ifscCode" TEXT,
  "currencyCode" VARCHAR(3) NOT NULL DEFAULT 'INR',
  "ledgerAccountId" TEXT NOT NULL,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdById" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "finance_bank_accounts_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "finance_bank_accounts_last4_check" CHECK ("accountNumberLast4" ~ '^[0-9]{4}$'),
  CONSTRAINT "finance_bank_accounts_currency_check" CHECK ("currencyCode" = 'INR')
);

CREATE TABLE "bank_statements" (
  "id" TEXT NOT NULL,
  "statementNumber" TEXT NOT NULL,
  "bankAccountId" TEXT NOT NULL,
  "periodFrom" TIMESTAMP(3) NOT NULL,
  "periodTo" TIMESTAMP(3) NOT NULL,
  "openingBalance" DECIMAL(18,2) NOT NULL,
  "closingBalance" DECIMAL(18,2) NOT NULL,
  "sourceFileName" TEXT NOT NULL,
  "sourceFileHash" TEXT NOT NULL,
  "status" "BankStatementStatus" NOT NULL DEFAULT 'DRAFT',
  "importedById" TEXT NOT NULL,
  "submittedById" TEXT,
  "submittedAt" TIMESTAMP(3),
  "approvedById" TEXT,
  "approvedAt" TIMESTAMP(3),
  "rejectionComment" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "bank_statements_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "bank_statements_period_check" CHECK ("periodTo" >= "periodFrom")
);

CREATE TABLE "bank_statement_lines" (
  "id" TEXT NOT NULL,
  "statementId" TEXT NOT NULL,
  "sequence" INTEGER NOT NULL,
  "transactionDate" TIMESTAMP(3) NOT NULL,
  "valueDate" TIMESTAMP(3),
  "description" TEXT NOT NULL,
  "bankReference" TEXT,
  "debitAmount" DECIMAL(18,2) NOT NULL DEFAULT 0,
  "creditAmount" DECIMAL(18,2) NOT NULL DEFAULT 0,
  "runningBalance" DECIMAL(18,2),
  "resolution" "BankLineResolution" NOT NULL DEFAULT 'PENDING',
  "exceptionReason" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "bank_statement_lines_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "bank_statement_line_amount_check" CHECK (("debitAmount" > 0 AND "creditAmount" = 0) OR ("creditAmount" > 0 AND "debitAmount" = 0)),
  CONSTRAINT "bank_statement_line_exception_check" CHECK ("resolution" <> 'UNMATCHED_ACCEPTED' OR ("exceptionReason" IS NOT NULL AND length(trim("exceptionReason")) > 0))
);

CREATE TABLE "bank_transaction_matches" (
  "id" TEXT NOT NULL,
  "statementLineId" TEXT NOT NULL,
  "matchType" "BankMatchType" NOT NULL,
  "customerReceiptId" TEXT,
  "apPaymentId" TEXT,
  "journalEntryId" TEXT,
  "confidenceScore" DECIMAL(5,2) NOT NULL,
  "matchReason" TEXT NOT NULL,
  "confirmedById" TEXT,
  "confirmedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "bank_transaction_matches_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "bank_match_target_check" CHECK (("matchType" = 'CUSTOMER_RECEIPT' AND "customerReceiptId" IS NOT NULL AND "apPaymentId" IS NULL AND "journalEntryId" IS NULL) OR ("matchType" = 'VENDOR_PAYMENT' AND "apPaymentId" IS NOT NULL AND "customerReceiptId" IS NULL AND "journalEntryId" IS NULL) OR ("matchType" = 'JOURNAL_ENTRY' AND "journalEntryId" IS NOT NULL AND "customerReceiptId" IS NULL AND "apPaymentId" IS NULL)),
  CONSTRAINT "bank_match_confidence_check" CHECK ("confidenceScore" >= 0 AND "confidenceScore" <= 100)
);

CREATE INDEX "finance_bank_accounts_isActive_idx" ON "finance_bank_accounts"("isActive");
CREATE UNIQUE INDEX "bank_statements_statementNumber_key" ON "bank_statements"("statementNumber");
CREATE UNIQUE INDEX "bank_statements_sourceFileHash_key" ON "bank_statements"("sourceFileHash");
CREATE INDEX "bank_statements_bankAccountId_periodFrom_periodTo_idx" ON "bank_statements"("bankAccountId", "periodFrom", "periodTo");
CREATE INDEX "bank_statements_status_idx" ON "bank_statements"("status");
CREATE INDEX "bank_statement_lines_transactionDate_idx" ON "bank_statement_lines"("transactionDate");
CREATE INDEX "bank_statement_lines_resolution_idx" ON "bank_statement_lines"("resolution");
CREATE UNIQUE INDEX "bank_statement_lines_statementId_sequence_key" ON "bank_statement_lines"("statementId", "sequence");
CREATE UNIQUE INDEX "bank_transaction_matches_statementLineId_key" ON "bank_transaction_matches"("statementLineId");
CREATE UNIQUE INDEX "bank_transaction_matches_customerReceiptId_key" ON "bank_transaction_matches"("customerReceiptId");
CREATE UNIQUE INDEX "bank_transaction_matches_apPaymentId_key" ON "bank_transaction_matches"("apPaymentId");
CREATE UNIQUE INDEX "bank_transaction_matches_journalEntryId_key" ON "bank_transaction_matches"("journalEntryId");

ALTER TABLE "finance_bank_accounts" ADD CONSTRAINT "finance_bank_accounts_ledgerAccountId_fkey" FOREIGN KEY ("ledgerAccountId") REFERENCES "ledger_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "finance_bank_accounts" ADD CONSTRAINT "finance_bank_accounts_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "bank_statements" ADD CONSTRAINT "bank_statements_bankAccountId_fkey" FOREIGN KEY ("bankAccountId") REFERENCES "finance_bank_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "bank_statements" ADD CONSTRAINT "bank_statements_importedById_fkey" FOREIGN KEY ("importedById") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "bank_statements" ADD CONSTRAINT "bank_statements_submittedById_fkey" FOREIGN KEY ("submittedById") REFERENCES "employees"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "bank_statements" ADD CONSTRAINT "bank_statements_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "employees"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "bank_statement_lines" ADD CONSTRAINT "bank_statement_lines_statementId_fkey" FOREIGN KEY ("statementId") REFERENCES "bank_statements"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "bank_transaction_matches" ADD CONSTRAINT "bank_transaction_matches_statementLineId_fkey" FOREIGN KEY ("statementLineId") REFERENCES "bank_statement_lines"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "bank_transaction_matches" ADD CONSTRAINT "bank_transaction_matches_customerReceiptId_fkey" FOREIGN KEY ("customerReceiptId") REFERENCES "customer_receipts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "bank_transaction_matches" ADD CONSTRAINT "bank_transaction_matches_apPaymentId_fkey" FOREIGN KEY ("apPaymentId") REFERENCES "accounts_payable_payments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "bank_transaction_matches" ADD CONSTRAINT "bank_transaction_matches_journalEntryId_fkey" FOREIGN KEY ("journalEntryId") REFERENCES "journal_entries"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "bank_transaction_matches" ADD CONSTRAINT "bank_transaction_matches_confirmedById_fkey" FOREIGN KEY ("confirmedById") REFERENCES "employees"("id") ON DELETE SET NULL ON UPDATE CASCADE;
