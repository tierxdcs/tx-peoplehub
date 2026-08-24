ALTER TABLE "employees"
  ADD COLUMN "accessDeniedAt" TIMESTAMP(3),
  ADD COLUMN "accessDeniedById" TEXT,
  ADD COLUMN "accessDenialReason" TEXT;
