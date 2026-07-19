CREATE TYPE "FinanceReadinessStatus" AS ENUM ('READY', 'ACTION_REQUIRED');

CREATE TABLE "finance_production_settings" (
  "id" TEXT NOT NULL DEFAULT 'INDIA',
  "controlAccountMap" JSONB NOT NULL DEFAULT '{}',
  "gstMaxAttempts" INTEGER NOT NULL DEFAULT 5,
  "gstRetryDelayMinutes" INTEGER NOT NULL DEFAULT 15,
  "emailDeliveryEnabled" BOOLEAN NOT NULL DEFAULT false,
  "updatedById" TEXT,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "finance_production_settings_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "finance_readiness_runs" (
  "id" TEXT NOT NULL,
  "status" "FinanceReadinessStatus" NOT NULL,
  "checks" JSONB NOT NULL,
  "runById" TEXT NOT NULL,
  "runAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "finance_readiness_runs_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "finance_import_batches" (
  "id" TEXT NOT NULL,
  "kind" TEXT NOT NULL,
  "sourceFileName" TEXT NOT NULL,
  "sourceChecksum" TEXT NOT NULL,
  "rowCount" INTEGER NOT NULL,
  "journalEntryId" TEXT,
  "errors" JSONB NOT NULL DEFAULT '[]',
  "createdById" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "finance_import_batches_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "finance_readiness_runs_runAt_idx" ON "finance_readiness_runs"("runAt");
CREATE UNIQUE INDEX "finance_import_batches_sourceChecksum_key" ON "finance_import_batches"("sourceChecksum");
CREATE INDEX "finance_import_batches_kind_createdAt_idx" ON "finance_import_batches"("kind", "createdAt");
