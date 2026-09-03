ALTER TYPE "PayrollRunStatus" ADD VALUE IF NOT EXISTS 'PENDING_APPROVAL';
ALTER TYPE "PayrollRunStatus" ADD VALUE IF NOT EXISTS 'APPROVED';
ALTER TYPE "PayrollRunStatus" ADD VALUE IF NOT EXISTS 'PAID';

ALTER TABLE "payroll_runs"
  ADD COLUMN "submittedById" TEXT,
  ADD COLUMN "submittedAt" TIMESTAMP(3),
  ADD COLUMN "approvedById" TEXT,
  ADD COLUMN "approvedAt" TIMESTAMP(3),
  ADD COLUMN "accrualJournalEntryId" TEXT,
  ADD COLUMN "paymentJournalEntryId" TEXT,
  ADD COLUMN "paymentBankReference" TEXT,
  ADD COLUMN "paidAt" TIMESTAMP(3);

CREATE UNIQUE INDEX "payroll_runs_accrualJournalEntryId_key" ON "payroll_runs"("accrualJournalEntryId");
CREATE UNIQUE INDEX "payroll_runs_paymentJournalEntryId_key" ON "payroll_runs"("paymentJournalEntryId");
