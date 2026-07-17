-- Bill of Materials + Item Master + Inventory (R&D / Store).
-- Additive only: new enums, tables, and nullable/defaulted columns on existing
-- tables (employees.isRdHead default false, notifications.relatedBomId nullable).
-- No destructive steps; existing production data is preserved.

-- New enums
CREATE TYPE "ItemType" AS ENUM ('RAW_MATERIAL', 'COMPONENT', 'SUBASSEMBLY', 'FINISHED_GOOD', 'CONSUMABLE');
CREATE TYPE "BomStatus" AS ENUM ('DRAFT', 'PENDING_APPROVAL', 'REJECTED', 'RELEASED', 'OBSOLETE');
CREATE TYPE "BomLineSource" AS ENUM ('MAKE', 'BUY');
CREATE TYPE "BomEventType" AS ENUM ('CREATED', 'UPDATED', 'SUBMITTED', 'APPROVED', 'REJECTED', 'RELEASED', 'OBSOLETED', 'REVISION_CREATED');
CREATE TYPE "StockBucket" AS ENUM ('ON_HAND', 'BLOCKED');

-- NotificationType additions (must be separate statements from any use)
ALTER TYPE "NotificationType" ADD VALUE 'BOM_SUBMITTED';
ALTER TYPE "NotificationType" ADD VALUE 'BOM_APPROVED';
ALTER TYPE "NotificationType" ADD VALUE 'BOM_REJECTED';

-- R&D Head capability flag
ALTER TABLE "employees" ADD COLUMN "isRdHead" BOOLEAN NOT NULL DEFAULT false;

-- Notification BOM deep-link
ALTER TABLE "notifications" ADD COLUMN "relatedBomId" TEXT;

-- Item Master
CREATE TABLE "items" (
    "id" TEXT NOT NULL,
    "itemCode" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "itemType" "ItemType" NOT NULL,
    "baseUnitOfMeasure" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "defaultWastagePercent" DECIMAL(5,2),
    "drawingSpecReference" TEXT,
    "standardLeadTimeDays" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "items_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "items_itemCode_key" ON "items"("itemCode");
CREATE INDEX "items_itemType_idx" ON "items"("itemType");
CREATE INDEX "items_isActive_idx" ON "items"("isActive");

-- BOM header
CREATE TABLE "boms" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "revisionNumber" INTEGER NOT NULL,
    "status" "BomStatus" NOT NULL DEFAULT 'DRAFT',
    "effectiveDate" TIMESTAMP(3),
    "revisionNotes" TEXT,
    "createdById" TEXT NOT NULL,
    "submittedById" TEXT,
    "submittedAt" TIMESTAMP(3),
    "approvedById" TEXT,
    "approvedAt" TIMESTAMP(3),
    "rejectedById" TEXT,
    "rejectedAt" TIMESTAMP(3),
    "rejectionComment" TEXT,
    "approverSignatureTextSnapshot" TEXT,
    "approverSignatureFontSnapshot" "SignatureFont",
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "boms_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "boms_productId_revisionNumber_key" ON "boms"("productId", "revisionNumber");
CREATE INDEX "boms_productId_idx" ON "boms"("productId");
CREATE INDEX "boms_status_idx" ON "boms"("status");

-- BOM lines
CREATE TABLE "bom_lines" (
    "id" TEXT NOT NULL,
    "bomId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "quantityPerUnit" DECIMAL(14,4) NOT NULL,
    "unitOfMeasure" TEXT NOT NULL,
    "wastagePercent" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "makeBuy" "BomLineSource" NOT NULL DEFAULT 'BUY',
    "notes" TEXT,
    "drawingSpecReference" TEXT,
    "sequence" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "bom_lines_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "bom_lines_bomId_idx" ON "bom_lines"("bomId");
CREATE INDEX "bom_lines_itemId_idx" ON "bom_lines"("itemId");

-- BOM events (workflow/approval history)
CREATE TABLE "bom_events" (
    "id" TEXT NOT NULL,
    "bomId" TEXT NOT NULL,
    "type" "BomEventType" NOT NULL,
    "actorId" TEXT,
    "comment" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "bom_events_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "bom_events_bomId_createdAt_idx" ON "bom_events"("bomId", "createdAt");

-- Store locations
CREATE TABLE "store_locations" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "store_locations_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "store_locations_code_key" ON "store_locations"("code");

-- Stock balances (availableQuantity is derived on read, never stored)
CREATE TABLE "stock_balances" (
    "id" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "storeLocationId" TEXT NOT NULL,
    "onHandQuantity" DECIMAL(14,4) NOT NULL DEFAULT 0,
    "reservedQuantity" DECIMAL(14,4) NOT NULL DEFAULT 0,
    "blockedQuantity" DECIMAL(14,4) NOT NULL DEFAULT 0,
    "expectedReceiptQuantity" DECIMAL(14,4),
    "expectedReceiptDate" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "stock_balances_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "stock_balances_itemId_storeLocationId_key" ON "stock_balances"("itemId", "storeLocationId");
CREATE INDEX "stock_balances_itemId_idx" ON "stock_balances"("itemId");

-- Stock adjustments (append-only history)
CREATE TABLE "stock_adjustments" (
    "id" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "storeLocationId" TEXT NOT NULL,
    "bucket" "StockBucket" NOT NULL DEFAULT 'ON_HAND',
    "quantityChange" DECIMAL(14,4) NOT NULL,
    "reason" TEXT NOT NULL,
    "actorId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "stock_adjustments_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "stock_adjustments_itemId_storeLocationId_idx" ON "stock_adjustments"("itemId", "storeLocationId");
CREATE INDEX "stock_adjustments_createdAt_idx" ON "stock_adjustments"("createdAt");

-- Stock reservations (per kickoff)
CREATE TABLE "stock_reservations" (
    "id" TEXT NOT NULL,
    "kickoffId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "storeLocationId" TEXT NOT NULL,
    "quantity" DECIMAL(14,4) NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "cancelledById" TEXT,
    "cancelledAt" TIMESTAMP(3),
    CONSTRAINT "stock_reservations_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "stock_reservations_kickoffId_idx" ON "stock_reservations"("kickoffId");
CREATE INDEX "stock_reservations_itemId_storeLocationId_idx" ON "stock_reservations"("itemId", "storeLocationId");

-- Kickoff stock report snapshot
CREATE TABLE "kickoff_stock_reports" (
    "id" TEXT NOT NULL,
    "kickoffId" TEXT NOT NULL,
    "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "quantityPrecision" INTEGER NOT NULL DEFAULT 4,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "kickoff_stock_reports_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "kickoff_stock_reports_kickoffId_key" ON "kickoff_stock_reports"("kickoffId");

CREATE TABLE "kickoff_bom_selections" (
    "id" TEXT NOT NULL,
    "reportId" TEXT NOT NULL,
    "orderLineItemId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "productName" TEXT NOT NULL,
    "productSku" TEXT NOT NULL,
    "orderedQuantity" DECIMAL(14,4) NOT NULL,
    "bomId" TEXT NOT NULL,
    "bomRevisionNumber" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "kickoff_bom_selections_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "kickoff_bom_selections_reportId_idx" ON "kickoff_bom_selections"("reportId");

CREATE TABLE "kickoff_bom_snapshot_lines" (
    "id" TEXT NOT NULL,
    "selectionId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "itemCode" TEXT NOT NULL,
    "itemName" TEXT NOT NULL,
    "unitOfMeasure" TEXT NOT NULL,
    "quantityPerUnit" DECIMAL(14,4) NOT NULL,
    "wastagePercent" DECIMAL(5,2) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "kickoff_bom_snapshot_lines_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "kickoff_bom_snapshot_lines_selectionId_idx" ON "kickoff_bom_snapshot_lines"("selectionId");

-- Foreign keys
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_relatedBomId_fkey" FOREIGN KEY ("relatedBomId") REFERENCES "boms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "boms" ADD CONSTRAINT "boms_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "boms" ADD CONSTRAINT "boms_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "boms" ADD CONSTRAINT "boms_submittedById_fkey" FOREIGN KEY ("submittedById") REFERENCES "employees"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "boms" ADD CONSTRAINT "boms_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "employees"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "boms" ADD CONSTRAINT "boms_rejectedById_fkey" FOREIGN KEY ("rejectedById") REFERENCES "employees"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "bom_lines" ADD CONSTRAINT "bom_lines_bomId_fkey" FOREIGN KEY ("bomId") REFERENCES "boms"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "bom_lines" ADD CONSTRAINT "bom_lines_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "bom_events" ADD CONSTRAINT "bom_events_bomId_fkey" FOREIGN KEY ("bomId") REFERENCES "boms"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "bom_events" ADD CONSTRAINT "bom_events_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "employees"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "stock_balances" ADD CONSTRAINT "stock_balances_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "stock_balances" ADD CONSTRAINT "stock_balances_storeLocationId_fkey" FOREIGN KEY ("storeLocationId") REFERENCES "store_locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "stock_adjustments" ADD CONSTRAINT "stock_adjustments_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "stock_adjustments" ADD CONSTRAINT "stock_adjustments_storeLocationId_fkey" FOREIGN KEY ("storeLocationId") REFERENCES "store_locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "stock_adjustments" ADD CONSTRAINT "stock_adjustments_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "employees"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "stock_reservations" ADD CONSTRAINT "stock_reservations_kickoffId_fkey" FOREIGN KEY ("kickoffId") REFERENCES "project_kickoffs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "stock_reservations" ADD CONSTRAINT "stock_reservations_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "stock_reservations" ADD CONSTRAINT "stock_reservations_storeLocationId_fkey" FOREIGN KEY ("storeLocationId") REFERENCES "store_locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "stock_reservations" ADD CONSTRAINT "stock_reservations_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "stock_reservations" ADD CONSTRAINT "stock_reservations_cancelledById_fkey" FOREIGN KEY ("cancelledById") REFERENCES "employees"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "kickoff_stock_reports" ADD CONSTRAINT "kickoff_stock_reports_kickoffId_fkey" FOREIGN KEY ("kickoffId") REFERENCES "project_kickoffs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "kickoff_bom_selections" ADD CONSTRAINT "kickoff_bom_selections_reportId_fkey" FOREIGN KEY ("reportId") REFERENCES "kickoff_stock_reports"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "kickoff_bom_selections" ADD CONSTRAINT "kickoff_bom_selections_bomId_fkey" FOREIGN KEY ("bomId") REFERENCES "boms"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "kickoff_bom_snapshot_lines" ADD CONSTRAINT "kickoff_bom_snapshot_lines_selectionId_fkey" FOREIGN KEY ("selectionId") REFERENCES "kickoff_bom_selections"("id") ON DELETE CASCADE ON UPDATE CASCADE;
