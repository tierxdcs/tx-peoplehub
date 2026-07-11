-- CreateEnum
CREATE TYPE "VaultFileStatus" AS ENUM ('PENDING', 'ACTIVE', 'DELETED');

-- CreateEnum
CREATE TYPE "PreviewStatus" AS ENUM ('NOT_APPLICABLE', 'PENDING', 'READY', 'FAILED');

-- CreateTable
CREATE TABLE "vault_files" (
    "id" TEXT NOT NULL,
    "folderId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "currentVersionId" TEXT,
    "uploadedById" TEXT NOT NULL,
    "status" "VaultFileStatus" NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "vault_files_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vault_file_versions" (
    "id" TEXT NOT NULL,
    "fileId" TEXT NOT NULL,
    "versionNumber" INTEGER NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" BIGINT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "previewStorageKey" TEXT,
    "previewStatus" "PreviewStatus" NOT NULL DEFAULT 'NOT_APPLICABLE',
    "changeNote" TEXT,
    "uploadedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "vault_file_versions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "vault_files_currentVersionId_key" ON "vault_files"("currentVersionId");

-- CreateIndex
CREATE INDEX "vault_files_folderId_status_idx" ON "vault_files"("folderId", "status");

-- CreateIndex
CREATE INDEX "vault_file_versions_fileId_idx" ON "vault_file_versions"("fileId");

-- CreateIndex
CREATE UNIQUE INDEX "vault_file_versions_fileId_versionNumber_key" ON "vault_file_versions"("fileId", "versionNumber");

-- AddForeignKey
ALTER TABLE "vault_files" ADD CONSTRAINT "vault_files_folderId_fkey" FOREIGN KEY ("folderId") REFERENCES "vault_folders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vault_files" ADD CONSTRAINT "vault_files_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "employees"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vault_file_versions" ADD CONSTRAINT "vault_file_versions_fileId_fkey" FOREIGN KEY ("fileId") REFERENCES "vault_files"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vault_file_versions" ADD CONSTRAINT "vault_file_versions_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "employees"("id") ON DELETE CASCADE ON UPDATE CASCADE;

