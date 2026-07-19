CREATE TYPE "CloseTaskStatus" AS ENUM ('PENDING', 'COMPLETED', 'NOT_APPLICABLE');
CREATE TYPE "ReconciliationExceptionStatus" AS ENUM ('OPEN', 'RESOLVED', 'WAIVED');
CREATE TYPE "ReconciliationSeverity" AS ENUM ('INFO', 'WARNING', 'BLOCKING');

CREATE TABLE "period_close_tasks" (
  "id" TEXT NOT NULL, "periodCloseId" TEXT NOT NULL, "taskCode" TEXT NOT NULL, "title" TEXT NOT NULL,
  "category" TEXT NOT NULL, "sequence" INTEGER NOT NULL, "isRequired" BOOLEAN NOT NULL DEFAULT true,
  "status" "CloseTaskStatus" NOT NULL DEFAULT 'PENDING', "notes" TEXT, "completedById" TEXT,
  "completedAt" TIMESTAMP(3), "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "period_close_tasks_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "period_close_tasks_periodCloseId_taskCode_key" ON "period_close_tasks"("periodCloseId", "taskCode");
CREATE INDEX "period_close_tasks_periodCloseId_status_idx" ON "period_close_tasks"("periodCloseId", "status");
ALTER TABLE "period_close_tasks" ADD CONSTRAINT "period_close_tasks_periodCloseId_fkey" FOREIGN KEY ("periodCloseId") REFERENCES "period_closes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "close_reconciliation_runs" (
  "id" TEXT NOT NULL, "periodCloseId" TEXT NOT NULL, "status" TEXT NOT NULL, "summary" JSONB NOT NULL,
  "generatedById" TEXT NOT NULL, "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "close_reconciliation_runs_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "close_reconciliation_runs_periodCloseId_key" ON "close_reconciliation_runs"("periodCloseId");
ALTER TABLE "close_reconciliation_runs" ADD CONSTRAINT "close_reconciliation_runs_periodCloseId_fkey" FOREIGN KEY ("periodCloseId") REFERENCES "period_closes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "reconciliation_exceptions" (
  "id" TEXT NOT NULL, "runId" TEXT NOT NULL, "exceptionKey" TEXT NOT NULL, "controlType" TEXT NOT NULL,
  "title" TEXT NOT NULL, "severity" "ReconciliationSeverity" NOT NULL,
  "status" "ReconciliationExceptionStatus" NOT NULL DEFAULT 'OPEN', "ledgerAmount" DECIMAL(18,2),
  "sourceAmount" DECIMAL(18,2), "variance" DECIMAL(18,2), "details" JSONB, "assignedToId" TEXT,
  "resolutionNote" TEXT, "resolvedById" TEXT, "resolvedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "reconciliation_exceptions_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "reconciliation_exceptions_runId_exceptionKey_key" ON "reconciliation_exceptions"("runId", "exceptionKey");
CREATE INDEX "reconciliation_exceptions_status_severity_idx" ON "reconciliation_exceptions"("status", "severity");
ALTER TABLE "reconciliation_exceptions" ADD CONSTRAINT "reconciliation_exceptions_runId_fkey" FOREIGN KEY ("runId") REFERENCES "close_reconciliation_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
