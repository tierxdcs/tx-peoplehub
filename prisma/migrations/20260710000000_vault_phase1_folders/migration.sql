-- CreateEnum
CREATE TYPE "VaultFolderType" AS ENUM ('PERSONAL', 'DEFAULT', 'CUSTOM');

-- CreateEnum
CREATE TYPE "VaultVisibilityScope" AS ENUM ('PRIVATE', 'TEAM', 'VERTICAL', 'COMPANY_WIDE');

-- CreateEnum
CREATE TYPE "VaultFolderStatus" AS ENUM ('ACTIVE', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "VaultGranteeType" AS ENUM ('EMPLOYEE', 'VERTICAL', 'ROLE');

-- CreateTable
CREATE TABLE "vault_folders" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "parentFolderId" TEXT,
    "type" "VaultFolderType" NOT NULL,
    "ownerId" TEXT NOT NULL,
    "visibilityScope" "VaultVisibilityScope" NOT NULL,
    "scopeVerticalId" TEXT,
    "versioningEnabled" BOOLEAN NOT NULL DEFAULT false,
    "maxVersionsRetained" INTEGER DEFAULT 5,
    "status" "VaultFolderStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "vault_folders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vault_folder_permissions" (
    "id" TEXT NOT NULL,
    "folderId" TEXT NOT NULL,
    "granteeType" "VaultGranteeType" NOT NULL,
    "granteeId" TEXT NOT NULL,
    "canRead" BOOLEAN NOT NULL DEFAULT false,
    "canWrite" BOOLEAN NOT NULL DEFAULT false,
    "canDelete" BOOLEAN NOT NULL DEFAULT false,
    "canCreateSubfolder" BOOLEAN NOT NULL DEFAULT false,
    "grantedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "vault_folder_permissions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "vault_folders_ownerId_idx" ON "vault_folders"("ownerId");

-- CreateIndex
CREATE INDEX "vault_folders_parentFolderId_idx" ON "vault_folders"("parentFolderId");

-- CreateIndex
CREATE INDEX "vault_folders_visibilityScope_scopeVerticalId_idx" ON "vault_folders"("visibilityScope", "scopeVerticalId");

-- CreateIndex
CREATE INDEX "vault_folder_permissions_granteeType_granteeId_idx" ON "vault_folder_permissions"("granteeType", "granteeId");

-- CreateIndex
CREATE UNIQUE INDEX "vault_folder_permissions_folderId_granteeType_granteeId_key" ON "vault_folder_permissions"("folderId", "granteeType", "granteeId");

-- AddForeignKey
ALTER TABLE "vault_folders" ADD CONSTRAINT "vault_folders_parentFolderId_fkey" FOREIGN KEY ("parentFolderId") REFERENCES "vault_folders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vault_folders" ADD CONSTRAINT "vault_folders_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "employees"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vault_folders" ADD CONSTRAINT "vault_folders_scopeVerticalId_fkey" FOREIGN KEY ("scopeVerticalId") REFERENCES "verticals"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vault_folder_permissions" ADD CONSTRAINT "vault_folder_permissions_folderId_fkey" FOREIGN KEY ("folderId") REFERENCES "vault_folders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vault_folder_permissions" ADD CONSTRAINT "vault_folder_permissions_grantedById_fkey" FOREIGN KEY ("grantedById") REFERENCES "employees"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- One PERSONAL folder per employee, enforced at the DB level. A partial
-- unique index (not expressible in Prisma schema syntax) so DEFAULT/CUSTOM
-- folders are unaffected.
CREATE UNIQUE INDEX "vault_folders_one_personal_per_employee"
  ON "vault_folders" ("ownerId")
  WHERE "type" = 'PERSONAL';
