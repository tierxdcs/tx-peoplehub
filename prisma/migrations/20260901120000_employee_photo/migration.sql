-- Employee photo: a nullable R2 object key for the employee's photo, uploaded
-- via the same presigned direct-to-storage flow as Vault/PLM photos. Used for
-- ID cards and other collaterals. Purely additive — no data migration.

-- AlterTable
ALTER TABLE "employees" ADD COLUMN "photoStorageKey" TEXT;
