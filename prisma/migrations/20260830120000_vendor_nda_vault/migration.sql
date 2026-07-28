CREATE TABLE "company_document_config" (
  "id" TEXT NOT NULL DEFAULT 'DEFAULT',
  "ndaTemplateFileId" TEXT,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "company_document_config_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "vendor_questionnaires" ADD COLUMN "signedNdaFileId" TEXT;

CREATE UNIQUE INDEX "company_document_config_ndaTemplateFileId_key"
  ON "company_document_config"("ndaTemplateFileId");
CREATE UNIQUE INDEX "vendor_questionnaires_signedNdaFileId_key"
  ON "vendor_questionnaires"("signedNdaFileId");

ALTER TABLE "company_document_config"
  ADD CONSTRAINT "company_document_config_ndaTemplateFileId_fkey"
  FOREIGN KEY ("ndaTemplateFileId") REFERENCES "vault_files"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "vendor_questionnaires"
  ADD CONSTRAINT "vendor_questionnaires_signedNdaFileId_fkey"
  FOREIGN KEY ("signedNdaFileId") REFERENCES "vault_files"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
