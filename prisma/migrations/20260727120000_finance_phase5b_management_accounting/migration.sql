-- CreateEnum
CREATE TYPE "FinanceBudgetStatus" AS ENUM ('DRAFT', 'PENDING_APPROVAL', 'REJECTED', 'APPROVED', 'LOCKED');

-- CreateEnum
CREATE TYPE "FixedAssetStatus" AS ENUM ('DRAFT', 'PENDING_APPROVAL', 'REJECTED', 'ACTIVE', 'DISPOSED', 'WRITTEN_OFF');

-- CreateEnum
CREATE TYPE "FinanceScheduleType" AS ENUM ('RECURRING_JOURNAL', 'ACCRUAL', 'PREPAYMENT');

-- CreateEnum
CREATE TYPE "FinanceScheduleStatus" AS ENUM ('DRAFT', 'PENDING_APPROVAL', 'REJECTED', 'ACTIVE', 'PAUSED', 'COMPLETED');

-- CreateTable
CREATE TABLE "finance_budgets" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "fiscalYearId" TEXT NOT NULL,
    "status" "FinanceBudgetStatus" NOT NULL DEFAULT 'DRAFT',
    "notes" TEXT,
    "createdById" TEXT NOT NULL,
    "submittedById" TEXT,
    "submittedAt" TIMESTAMP(3),
    "approvedById" TEXT,
    "approvedAt" TIMESTAMP(3),
    "rejectionComment" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "finance_budgets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "finance_budget_lines" (
    "id" TEXT NOT NULL,
    "budgetId" TEXT NOT NULL,
    "periodId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "costCenterId" TEXT,
    "projectReference" TEXT,
    "amount" DECIMAL(18,2) NOT NULL,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "finance_budget_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fixed_assets" (
    "id" TEXT NOT NULL,
    "assetNumber" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "status" "FixedAssetStatus" NOT NULL DEFAULT 'DRAFT',
    "purchaseDate" TIMESTAMP(3) NOT NULL,
    "capitalizationDate" TIMESTAMP(3) NOT NULL,
    "originalCost" DECIMAL(18,2) NOT NULL,
    "residualValue" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "usefulLifeMonths" INTEGER NOT NULL,
    "accumulatedDepreciation" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "lastDepreciatedThrough" TIMESTAMP(3),
    "location" TEXT,
    "serialNumber" TEXT,
    "vendorReference" TEXT,
    "assetAccountId" TEXT NOT NULL,
    "accumulatedDepreciationAccountId" TEXT NOT NULL,
    "depreciationExpenseAccountId" TEXT NOT NULL,
    "acquisitionCreditAccountId" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "approvedById" TEXT,
    "approvedAt" TIMESTAMP(3),
    "rejectionComment" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "fixed_assets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "asset_depreciation_entries" (
    "id" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "periodId" TEXT NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "journalEntryId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "asset_depreciation_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "finance_schedules" (
    "id" TEXT NOT NULL,
    "scheduleNumber" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "scheduleType" "FinanceScheduleType" NOT NULL,
    "status" "FinanceScheduleStatus" NOT NULL DEFAULT 'DRAFT',
    "debitAccountId" TEXT NOT NULL,
    "creditAccountId" TEXT NOT NULL,
    "amountPerRun" DECIMAL(18,2) NOT NULL,
    "startDate" TIMESTAMP(3) NOT NULL,
    "nextRunDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3),
    "remainingRuns" INTEGER,
    "costCenterId" TEXT,
    "projectReference" TEXT,
    "createdById" TEXT NOT NULL,
    "approvedById" TEXT,
    "approvedAt" TIMESTAMP(3),
    "rejectionComment" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "finance_schedules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "finance_schedule_executions" (
    "id" TEXT NOT NULL,
    "scheduleId" TEXT NOT NULL,
    "runDate" TIMESTAMP(3) NOT NULL,
    "periodId" TEXT NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "journalEntryId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "finance_schedule_executions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "finance_budgets_status_idx" ON "finance_budgets"("status");

-- CreateIndex
CREATE UNIQUE INDEX "finance_budgets_fiscalYearId_name_key" ON "finance_budgets"("fiscalYearId", "name");

-- CreateIndex
CREATE INDEX "finance_budget_lines_periodId_accountId_idx" ON "finance_budget_lines"("periodId", "accountId");

-- CreateIndex
CREATE INDEX "finance_budget_lines_costCenterId_idx" ON "finance_budget_lines"("costCenterId");

-- CreateIndex
CREATE UNIQUE INDEX "finance_budget_lines_budgetId_periodId_accountId_costCenter_key" ON "finance_budget_lines"("budgetId", "periodId", "accountId", "costCenterId", "projectReference");

-- CreateIndex
CREATE UNIQUE INDEX "fixed_assets_assetNumber_key" ON "fixed_assets"("assetNumber");

-- CreateIndex
CREATE INDEX "fixed_assets_status_idx" ON "fixed_assets"("status");

-- CreateIndex
CREATE INDEX "fixed_assets_capitalizationDate_idx" ON "fixed_assets"("capitalizationDate");

-- CreateIndex
CREATE UNIQUE INDEX "asset_depreciation_entries_journalEntryId_key" ON "asset_depreciation_entries"("journalEntryId");

-- CreateIndex
CREATE INDEX "asset_depreciation_entries_periodId_idx" ON "asset_depreciation_entries"("periodId");

-- CreateIndex
CREATE UNIQUE INDEX "asset_depreciation_entries_assetId_periodId_key" ON "asset_depreciation_entries"("assetId", "periodId");

-- CreateIndex
CREATE UNIQUE INDEX "finance_schedules_scheduleNumber_key" ON "finance_schedules"("scheduleNumber");

-- CreateIndex
CREATE INDEX "finance_schedules_status_nextRunDate_idx" ON "finance_schedules"("status", "nextRunDate");

-- CreateIndex
CREATE UNIQUE INDEX "finance_schedule_executions_journalEntryId_key" ON "finance_schedule_executions"("journalEntryId");

-- CreateIndex
CREATE INDEX "finance_schedule_executions_periodId_idx" ON "finance_schedule_executions"("periodId");

-- CreateIndex
CREATE UNIQUE INDEX "finance_schedule_executions_scheduleId_runDate_key" ON "finance_schedule_executions"("scheduleId", "runDate");

-- CreateIndex
-- AddForeignKey
ALTER TABLE "finance_budgets" ADD CONSTRAINT "finance_budgets_fiscalYearId_fkey" FOREIGN KEY ("fiscalYearId") REFERENCES "fiscal_years"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "finance_budgets" ADD CONSTRAINT "finance_budgets_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "finance_budgets" ADD CONSTRAINT "finance_budgets_submittedById_fkey" FOREIGN KEY ("submittedById") REFERENCES "employees"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "finance_budgets" ADD CONSTRAINT "finance_budgets_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "employees"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "finance_budget_lines" ADD CONSTRAINT "finance_budget_lines_budgetId_fkey" FOREIGN KEY ("budgetId") REFERENCES "finance_budgets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "finance_budget_lines" ADD CONSTRAINT "finance_budget_lines_periodId_fkey" FOREIGN KEY ("periodId") REFERENCES "accounting_periods"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "finance_budget_lines" ADD CONSTRAINT "finance_budget_lines_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "ledger_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "finance_budget_lines" ADD CONSTRAINT "finance_budget_lines_costCenterId_fkey" FOREIGN KEY ("costCenterId") REFERENCES "cost_centers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fixed_assets" ADD CONSTRAINT "fixed_assets_assetAccountId_fkey" FOREIGN KEY ("assetAccountId") REFERENCES "ledger_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fixed_assets" ADD CONSTRAINT "fixed_assets_accumulatedDepreciationAccountId_fkey" FOREIGN KEY ("accumulatedDepreciationAccountId") REFERENCES "ledger_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fixed_assets" ADD CONSTRAINT "fixed_assets_depreciationExpenseAccountId_fkey" FOREIGN KEY ("depreciationExpenseAccountId") REFERENCES "ledger_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fixed_assets" ADD CONSTRAINT "fixed_assets_acquisitionCreditAccountId_fkey" FOREIGN KEY ("acquisitionCreditAccountId") REFERENCES "ledger_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fixed_assets" ADD CONSTRAINT "fixed_assets_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fixed_assets" ADD CONSTRAINT "fixed_assets_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "employees"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "asset_depreciation_entries" ADD CONSTRAINT "asset_depreciation_entries_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "fixed_assets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "asset_depreciation_entries" ADD CONSTRAINT "asset_depreciation_entries_periodId_fkey" FOREIGN KEY ("periodId") REFERENCES "accounting_periods"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "asset_depreciation_entries" ADD CONSTRAINT "asset_depreciation_entries_journalEntryId_fkey" FOREIGN KEY ("journalEntryId") REFERENCES "journal_entries"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "finance_schedules" ADD CONSTRAINT "finance_schedules_debitAccountId_fkey" FOREIGN KEY ("debitAccountId") REFERENCES "ledger_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "finance_schedules" ADD CONSTRAINT "finance_schedules_creditAccountId_fkey" FOREIGN KEY ("creditAccountId") REFERENCES "ledger_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "finance_schedules" ADD CONSTRAINT "finance_schedules_costCenterId_fkey" FOREIGN KEY ("costCenterId") REFERENCES "cost_centers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "finance_schedules" ADD CONSTRAINT "finance_schedules_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "finance_schedules" ADD CONSTRAINT "finance_schedules_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "employees"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "finance_schedule_executions" ADD CONSTRAINT "finance_schedule_executions_scheduleId_fkey" FOREIGN KEY ("scheduleId") REFERENCES "finance_schedules"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "finance_schedule_executions" ADD CONSTRAINT "finance_schedule_executions_periodId_fkey" FOREIGN KEY ("periodId") REFERENCES "accounting_periods"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "finance_schedule_executions" ADD CONSTRAINT "finance_schedule_executions_journalEntryId_fkey" FOREIGN KEY ("journalEntryId") REFERENCES "journal_entries"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Finance-grade invariants in addition to service/DTO validation.
ALTER TABLE "finance_budget_lines"
  ADD CONSTRAINT "finance_budget_line_amount_check" CHECK ("amount" >= 0);

ALTER TABLE "fixed_assets"
  ADD CONSTRAINT "fixed_asset_values_check" CHECK (
    "originalCost" > 0 AND "residualValue" >= 0 AND
    "residualValue" < "originalCost" AND "usefulLifeMonths" > 0 AND
    "accumulatedDepreciation" >= 0 AND
    "accumulatedDepreciation" <= "originalCost" - "residualValue"
  );

ALTER TABLE "asset_depreciation_entries"
  ADD CONSTRAINT "asset_depreciation_amount_check" CHECK ("amount" > 0);

ALTER TABLE "finance_schedules"
  ADD CONSTRAINT "finance_schedule_values_check" CHECK (
    "debitAccountId" <> "creditAccountId" AND "amountPerRun" > 0 AND
    ("endDate" IS NULL OR "endDate" >= "startDate") AND
    ("remainingRuns" IS NULL OR "remainingRuns" > 0)
  );

ALTER TABLE "finance_schedule_executions"
  ADD CONSTRAINT "finance_schedule_execution_amount_check" CHECK ("amount" > 0);
