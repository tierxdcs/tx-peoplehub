-- Lead attachments: link a Lead to a VaultFile (bytes + preview live in the
-- Vault). Idempotent so it is safe to (re-)run on any database state.

-- CreateTable
CREATE TABLE IF NOT EXISTS "lead_attachments" (
    "id" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "vaultFileId" TEXT NOT NULL,
    "uploadedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "lead_attachments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "lead_attachments_leadId_createdAt_idx" ON "lead_attachments"("leadId", "createdAt");
CREATE INDEX IF NOT EXISTS "lead_attachments_vaultFileId_idx" ON "lead_attachments"("vaultFileId");

-- AddForeignKey
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'lead_attachments_leadId_fkey' AND conrelid = 'lead_attachments'::regclass) THEN
    ALTER TABLE "lead_attachments" ADD CONSTRAINT "lead_attachments_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "leads"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'lead_attachments_vaultFileId_fkey' AND conrelid = 'lead_attachments'::regclass) THEN
    ALTER TABLE "lead_attachments" ADD CONSTRAINT "lead_attachments_vaultFileId_fkey" FOREIGN KEY ("vaultFileId") REFERENCES "vault_files"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'lead_attachments_uploadedById_fkey' AND conrelid = 'lead_attachments'::regclass) THEN
    ALTER TABLE "lead_attachments" ADD CONSTRAINT "lead_attachments_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;
