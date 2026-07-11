-- CreateEnum
CREATE TYPE "VaultShareResourceType" AS ENUM ('FILE', 'FOLDER');

-- CreateEnum
CREATE TYPE "VaultSharePermission" AS ENUM ('VIEW', 'EDIT');

-- CreateTable
CREATE TABLE "vault_internal_shares" (
    "id" TEXT NOT NULL,
    "resourceType" "VaultShareResourceType" NOT NULL,
    "resourceId" TEXT NOT NULL,
    "sharedWithEmployeeId" TEXT NOT NULL,
    "permission" "VaultSharePermission" NOT NULL,
    "sharedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "vault_internal_shares_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "vault_internal_shares_sharedWithEmployeeId_idx" ON "vault_internal_shares"("sharedWithEmployeeId");

-- CreateIndex
CREATE INDEX "vault_internal_shares_resourceType_resourceId_idx" ON "vault_internal_shares"("resourceType", "resourceId");

-- CreateIndex
CREATE UNIQUE INDEX "vault_internal_shares_resourceType_resourceId_sharedWithEmp_key" ON "vault_internal_shares"("resourceType", "resourceId", "sharedWithEmployeeId");

-- AddForeignKey
ALTER TABLE "vault_internal_shares" ADD CONSTRAINT "vault_internal_shares_sharedWithEmployeeId_fkey" FOREIGN KEY ("sharedWithEmployeeId") REFERENCES "employees"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vault_internal_shares" ADD CONSTRAINT "vault_internal_shares_sharedById_fkey" FOREIGN KEY ("sharedById") REFERENCES "employees"("id") ON DELETE CASCADE ON UPDATE CASCADE;

