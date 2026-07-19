-- Stores Phase 2: Goods Receipt Notes + QC Inspection Gate + Non-Conformance
-- Reports. Additive. Adds the isQcInspector designation flag on employees, three
-- new enums, and three new tables. No stock movement is triggered by any of
-- this schema — that happens at the service layer on QC finalization.

-- QC inspector designation (separate from isInternalAuditor; multi-holder).
ALTER TABLE "employees" ADD COLUMN "isQcInspector" BOOLEAN NOT NULL DEFAULT false;

CREATE TYPE "GoodsReceiptNoteStatus" AS ENUM (
  'DRAFT', 'PENDING_QC', 'QC_PASSED', 'QC_PARTIAL', 'QC_FAILED', 'CANCELLED'
);
CREATE TYPE "NonConformanceReportStatus" AS ENUM (
  'OPEN', 'DISPOSITIONED', 'CLOSED'
);
CREATE TYPE "NcrDispositionType" AS ENUM (
  'RETURN_TO_SUPPLIER', 'SCRAP', 'USE_AS_IS', 'REWORK'
);

CREATE TABLE "goods_receipt_notes" (
  "id" TEXT NOT NULL,
  "grnNumber" TEXT NOT NULL,
  "status" "GoodsReceiptNoteStatus" NOT NULL DEFAULT 'DRAFT',
  "purchaseOrderId" TEXT NOT NULL,
  "receivedById" TEXT NOT NULL,
  "receivedDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "inspectedById" TEXT,
  "inspectedAt" TIMESTAMP(3),
  "notes" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "goods_receipt_notes_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "goods_receipt_notes_grnNumber_key" ON "goods_receipt_notes"("grnNumber");
CREATE INDEX "goods_receipt_notes_status_idx" ON "goods_receipt_notes"("status");
CREATE INDEX "goods_receipt_notes_purchaseOrderId_idx" ON "goods_receipt_notes"("purchaseOrderId");

CREATE TABLE "goods_receipt_note_lines" (
  "id" TEXT NOT NULL,
  "grnId" TEXT NOT NULL,
  "purchaseOrderLineId" TEXT NOT NULL,
  "itemId" TEXT NOT NULL,
  "storeLocationId" TEXT NOT NULL,
  "receivedQuantity" DECIMAL(14,4) NOT NULL,
  "acceptedQuantity" DECIMAL(14,4),
  "rejectedQuantity" DECIMAL(14,4),
  "rejectionReason" TEXT,
  "sequence" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "goods_receipt_note_lines_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "goods_receipt_note_lines_grnId_idx" ON "goods_receipt_note_lines"("grnId");
CREATE INDEX "goods_receipt_note_lines_purchaseOrderLineId_idx" ON "goods_receipt_note_lines"("purchaseOrderLineId");
CREATE INDEX "goods_receipt_note_lines_itemId_idx" ON "goods_receipt_note_lines"("itemId");

CREATE TABLE "non_conformance_reports" (
  "id" TEXT NOT NULL,
  "ncrNumber" TEXT NOT NULL,
  "status" "NonConformanceReportStatus" NOT NULL DEFAULT 'OPEN',
  "grnId" TEXT NOT NULL,
  "grnLineId" TEXT NOT NULL,
  "itemId" TEXT NOT NULL,
  "rejectedQuantity" DECIMAL(14,4) NOT NULL,
  "rejectionReason" TEXT,
  "disposition" "NcrDispositionType",
  "dispositionNotes" TEXT,
  "raisedById" TEXT NOT NULL,
  "dispositionedById" TEXT,
  "dispositionedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "non_conformance_reports_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "non_conformance_reports_ncrNumber_key" ON "non_conformance_reports"("ncrNumber");
CREATE UNIQUE INDEX "non_conformance_reports_grnLineId_key" ON "non_conformance_reports"("grnLineId");
CREATE INDEX "non_conformance_reports_status_idx" ON "non_conformance_reports"("status");
CREATE INDEX "non_conformance_reports_grnId_idx" ON "non_conformance_reports"("grnId");

ALTER TABLE "goods_receipt_notes" ADD CONSTRAINT "goods_receipt_notes_purchaseOrderId_fkey"
  FOREIGN KEY ("purchaseOrderId") REFERENCES "purchase_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "goods_receipt_notes" ADD CONSTRAINT "goods_receipt_notes_receivedById_fkey"
  FOREIGN KEY ("receivedById") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "goods_receipt_notes" ADD CONSTRAINT "goods_receipt_notes_inspectedById_fkey"
  FOREIGN KEY ("inspectedById") REFERENCES "employees"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "goods_receipt_note_lines" ADD CONSTRAINT "goods_receipt_note_lines_grnId_fkey"
  FOREIGN KEY ("grnId") REFERENCES "goods_receipt_notes"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "goods_receipt_note_lines" ADD CONSTRAINT "goods_receipt_note_lines_purchaseOrderLineId_fkey"
  FOREIGN KEY ("purchaseOrderLineId") REFERENCES "purchase_order_lines"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "goods_receipt_note_lines" ADD CONSTRAINT "goods_receipt_note_lines_itemId_fkey"
  FOREIGN KEY ("itemId") REFERENCES "items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "goods_receipt_note_lines" ADD CONSTRAINT "goods_receipt_note_lines_storeLocationId_fkey"
  FOREIGN KEY ("storeLocationId") REFERENCES "store_locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "non_conformance_reports" ADD CONSTRAINT "non_conformance_reports_grnId_fkey"
  FOREIGN KEY ("grnId") REFERENCES "goods_receipt_notes"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "non_conformance_reports" ADD CONSTRAINT "non_conformance_reports_grnLineId_fkey"
  FOREIGN KEY ("grnLineId") REFERENCES "goods_receipt_note_lines"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "non_conformance_reports" ADD CONSTRAINT "non_conformance_reports_itemId_fkey"
  FOREIGN KEY ("itemId") REFERENCES "items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "non_conformance_reports" ADD CONSTRAINT "non_conformance_reports_raisedById_fkey"
  FOREIGN KEY ("raisedById") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "non_conformance_reports" ADD CONSTRAINT "non_conformance_reports_dispositionedById_fkey"
  FOREIGN KEY ("dispositionedById") REFERENCES "employees"("id") ON DELETE SET NULL ON UPDATE CASCADE;
