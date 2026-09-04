CREATE TYPE "LogisticsAccessLevel" AS ENUM ('VIEW', 'OPERATE');

ALTER TABLE "employees"
  ADD COLUMN "logisticsAccessLevel" "LogisticsAccessLevel",
  ADD COLUMN "logisticsAccessStartsAt" TIMESTAMP(3),
  ADD COLUMN "logisticsAccessExpiresAt" TIMESTAMP(3),
  ADD COLUMN "logisticsAccessGrantedAt" TIMESTAMP(3),
  ADD COLUMN "logisticsAccessGrantedById" TEXT,
  ADD COLUMN "logisticsAccessRevokedAt" TIMESTAMP(3),
  ADD COLUMN "logisticsAccessRevokedById" TEXT;

CREATE INDEX "employees_logisticsAccessExpiresAt_idx"
ON "employees"("logisticsAccessExpiresAt");
