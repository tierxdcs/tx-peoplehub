-- CreateTable
CREATE TABLE "vault_external_share_links" (
    "id" TEXT NOT NULL,
    "resourceType" "VaultShareResourceType" NOT NULL,
    "resourceId" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "permission" "VaultSharePermission" NOT NULL DEFAULT 'VIEW',
    "pinnedVersionId" TEXT,
    "passwordHash" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "vault_external_share_links_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vault_external_access_logs" (
    "id" TEXT NOT NULL,
    "shareLinkId" TEXT NOT NULL,
    "accessedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ipAddress" TEXT,
    "userAgent" TEXT,

    CONSTRAINT "vault_external_access_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "vault_external_share_links_token_key" ON "vault_external_share_links"("token");

-- CreateIndex
CREATE INDEX "vault_external_share_links_resourceType_resourceId_idx" ON "vault_external_share_links"("resourceType", "resourceId");

-- CreateIndex
CREATE INDEX "vault_external_access_logs_shareLinkId_idx" ON "vault_external_access_logs"("shareLinkId");

-- AddForeignKey
ALTER TABLE "vault_external_share_links" ADD CONSTRAINT "vault_external_share_links_pinnedVersionId_fkey" FOREIGN KEY ("pinnedVersionId") REFERENCES "vault_file_versions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vault_external_share_links" ADD CONSTRAINT "vault_external_share_links_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "employees"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vault_external_access_logs" ADD CONSTRAINT "vault_external_access_logs_shareLinkId_fkey" FOREIGN KEY ("shareLinkId") REFERENCES "vault_external_share_links"("id") ON DELETE CASCADE ON UPDATE CASCADE;

