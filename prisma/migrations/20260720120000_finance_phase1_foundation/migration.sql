-- Finance & Accounts Phase 1: additive accounting foundation.
ALTER TABLE "employees" ADD COLUMN "isAccountsHead" BOOLEAN NOT NULL DEFAULT false;

CREATE TYPE "FiscalYearStatus" AS ENUM ('OPEN', 'SOFT_CLOSED', 'CLOSED');
CREATE TYPE "AccountingPeriodStatus" AS ENUM ('OPEN', 'SOFT_CLOSED', 'CLOSED');
CREATE TYPE "AccountType" AS ENUM ('ASSET', 'LIABILITY', 'EQUITY', 'REVENUE', 'COST_OF_GOODS_SOLD', 'EXPENSE', 'OTHER_INCOME', 'OTHER_EXPENSE');
CREATE TYPE "NormalBalance" AS ENUM ('DEBIT', 'CREDIT');
CREATE TYPE "JournalStatus" AS ENUM ('DRAFT', 'PENDING_APPROVAL', 'POSTED', 'REJECTED', 'REVERSED');

CREATE TABLE "fiscal_years" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "startsOn" TIMESTAMP(3) NOT NULL,
  "endsOn" TIMESTAMP(3) NOT NULL,
  "status" "FiscalYearStatus" NOT NULL DEFAULT 'OPEN',
  "createdById" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "fiscal_years_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "fiscal_years_name_key" ON "fiscal_years"("name");
CREATE INDEX "fiscal_years_startsOn_endsOn_idx" ON "fiscal_years"("startsOn", "endsOn");

CREATE TABLE "accounting_periods" (
  "id" TEXT NOT NULL,
  "fiscalYearId" TEXT NOT NULL,
  "periodNumber" INTEGER NOT NULL,
  "name" TEXT NOT NULL,
  "startsOn" TIMESTAMP(3) NOT NULL,
  "endsOn" TIMESTAMP(3) NOT NULL,
  "status" "AccountingPeriodStatus" NOT NULL DEFAULT 'OPEN',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "accounting_periods_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "accounting_periods_fiscalYearId_periodNumber_key" ON "accounting_periods"("fiscalYearId", "periodNumber");
CREATE INDEX "accounting_periods_startsOn_endsOn_idx" ON "accounting_periods"("startsOn", "endsOn");

CREATE TABLE "ledger_accounts" (
  "id" TEXT NOT NULL,
  "code" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "accountType" "AccountType" NOT NULL,
  "normalBalance" "NormalBalance" NOT NULL,
  "description" TEXT,
  "parentId" TEXT,
  "isControlAccount" BOOLEAN NOT NULL DEFAULT false,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdById" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ledger_accounts_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ledger_accounts_code_key" ON "ledger_accounts"("code");
CREATE INDEX "ledger_accounts_accountType_isActive_idx" ON "ledger_accounts"("accountType", "isActive");
CREATE INDEX "ledger_accounts_parentId_idx" ON "ledger_accounts"("parentId");

CREATE TABLE "cost_centers" (
  "id" TEXT NOT NULL,
  "code" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "description" TEXT,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdById" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "cost_centers_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "cost_centers_code_key" ON "cost_centers"("code");

CREATE TABLE "currencies" (
  "code" VARCHAR(3) NOT NULL,
  "name" TEXT NOT NULL,
  "symbol" TEXT NOT NULL,
  "decimalPlaces" INTEGER NOT NULL DEFAULT 2,
  "isBase" BOOLEAN NOT NULL DEFAULT false,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "currencies_pkey" PRIMARY KEY ("code")
);
INSERT INTO "currencies" ("code", "name", "symbol", "isBase", "updatedAt") VALUES
  ('INR', 'Indian Rupee', '₹', true, CURRENT_TIMESTAMP),
  ('USD', 'US Dollar', '$', false, CURRENT_TIMESTAMP),
  ('CAD', 'Canadian Dollar', 'C$', false, CURRENT_TIMESTAMP),
  ('EUR', 'Euro', '€', false, CURRENT_TIMESTAMP);

CREATE TABLE "exchange_rates" (
  "id" TEXT NOT NULL,
  "currencyCode" VARCHAR(3) NOT NULL,
  "effectiveOn" TIMESTAMP(3) NOT NULL,
  "rateToInr" DECIMAL(18,6) NOT NULL,
  "source" TEXT NOT NULL,
  "createdById" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "exchange_rates_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "exchange_rates_currencyCode_effectiveOn_key" ON "exchange_rates"("currencyCode", "effectiveOn");
CREATE INDEX "exchange_rates_effectiveOn_idx" ON "exchange_rates"("effectiveOn");

CREATE TABLE "finance_sequences" (
  "entity" TEXT NOT NULL,
  "year" INTEGER NOT NULL,
  "lastValue" INTEGER NOT NULL DEFAULT 0,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "finance_sequences_pkey" PRIMARY KEY ("entity", "year")
);

CREATE TABLE "journal_entries" (
  "id" TEXT NOT NULL,
  "journalNumber" TEXT NOT NULL,
  "entryDate" TIMESTAMP(3) NOT NULL,
  "periodId" TEXT NOT NULL,
  "description" TEXT NOT NULL,
  "reference" TEXT,
  "status" "JournalStatus" NOT NULL DEFAULT 'DRAFT',
  "createdById" TEXT NOT NULL,
  "submittedById" TEXT,
  "submittedAt" TIMESTAMP(3),
  "approvedById" TEXT,
  "approvedAt" TIMESTAMP(3),
  "rejectedById" TEXT,
  "rejectedAt" TIMESTAMP(3),
  "rejectionComment" TEXT,
  "reversedById" TEXT,
  "reversedAt" TIMESTAMP(3),
  "reversalOfId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "journal_entries_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "journal_entries_journalNumber_key" ON "journal_entries"("journalNumber");
CREATE UNIQUE INDEX "journal_entries_reversalOfId_key" ON "journal_entries"("reversalOfId");
CREATE INDEX "journal_entries_entryDate_status_idx" ON "journal_entries"("entryDate", "status");
CREATE INDEX "journal_entries_periodId_status_idx" ON "journal_entries"("periodId", "status");

CREATE TABLE "journal_lines" (
  "id" TEXT NOT NULL,
  "journalId" TEXT NOT NULL,
  "sequence" INTEGER NOT NULL,
  "accountId" TEXT NOT NULL,
  "description" TEXT,
  "debit" DECIMAL(18,2) NOT NULL DEFAULT 0,
  "credit" DECIMAL(18,2) NOT NULL DEFAULT 0,
  "costCenterId" TEXT,
  "projectReference" TEXT,
  CONSTRAINT "journal_lines_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "journal_lines_journalId_sequence_key" ON "journal_lines"("journalId", "sequence");
CREATE INDEX "journal_lines_accountId_idx" ON "journal_lines"("accountId");
CREATE INDEX "journal_lines_costCenterId_idx" ON "journal_lines"("costCenterId");

ALTER TABLE "fiscal_years" ADD CONSTRAINT "fiscal_years_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "accounting_periods" ADD CONSTRAINT "accounting_periods_fiscalYearId_fkey" FOREIGN KEY ("fiscalYearId") REFERENCES "fiscal_years"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ledger_accounts" ADD CONSTRAINT "ledger_accounts_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "ledger_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ledger_accounts" ADD CONSTRAINT "ledger_accounts_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "cost_centers" ADD CONSTRAINT "cost_centers_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "exchange_rates" ADD CONSTRAINT "exchange_rates_currencyCode_fkey" FOREIGN KEY ("currencyCode") REFERENCES "currencies"("code") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "exchange_rates" ADD CONSTRAINT "exchange_rates_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_periodId_fkey" FOREIGN KEY ("periodId") REFERENCES "accounting_periods"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_submittedById_fkey" FOREIGN KEY ("submittedById") REFERENCES "employees"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "employees"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_rejectedById_fkey" FOREIGN KEY ("rejectedById") REFERENCES "employees"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_reversedById_fkey" FOREIGN KEY ("reversedById") REFERENCES "employees"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_reversalOfId_fkey" FOREIGN KEY ("reversalOfId") REFERENCES "journal_entries"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "journal_lines" ADD CONSTRAINT "journal_lines_journalId_fkey" FOREIGN KEY ("journalId") REFERENCES "journal_entries"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "journal_lines" ADD CONSTRAINT "journal_lines_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "ledger_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "journal_lines" ADD CONSTRAINT "journal_lines_costCenterId_fkey" FOREIGN KEY ("costCenterId") REFERENCES "cost_centers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Guard the sole active Finance Head at the database layer as well as service layer.
CREATE UNIQUE INDEX "employees_single_accounts_head_idx" ON "employees" ("isAccountsHead") WHERE "isAccountsHead" = true;

-- Journal integrity defense-in-depth. Service validation provides clearer errors.
ALTER TABLE "journal_lines" ADD CONSTRAINT "journal_lines_one_sided_check" CHECK (
  ("debit" > 0 AND "credit" = 0) OR ("credit" > 0 AND "debit" = 0)
);
