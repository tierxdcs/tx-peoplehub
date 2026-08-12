CREATE TABLE "rfq_attachments" (
  "id" TEXT NOT NULL,
  "rfqId" TEXT NOT NULL,
  "rfqLineId" TEXT,
  "fileKey" TEXT NOT NULL,
  "fileName" TEXT NOT NULL,
  "fileSize" INTEGER NOT NULL,
  "mimeType" TEXT NOT NULL,
  "uploadedById" TEXT NOT NULL,
  "uploadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "rfq_attachments_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "rfq_attachments_fileKey_key" ON "rfq_attachments"("fileKey");
CREATE INDEX "rfq_attachments_rfqId_idx" ON "rfq_attachments"("rfqId");
CREATE INDEX "rfq_attachments_rfqLineId_idx" ON "rfq_attachments"("rfqLineId");

ALTER TABLE "rfq_attachments" ADD CONSTRAINT "rfq_attachments_rfqId_fkey"
  FOREIGN KEY ("rfqId") REFERENCES "rfqs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "rfq_attachments" ADD CONSTRAINT "rfq_attachments_rfqLineId_fkey"
  FOREIGN KEY ("rfqLineId") REFERENCES "rfq_lines"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "rfq_attachments" ADD CONSTRAINT "rfq_attachments_uploadedById_fkey"
  FOREIGN KEY ("uploadedById") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
