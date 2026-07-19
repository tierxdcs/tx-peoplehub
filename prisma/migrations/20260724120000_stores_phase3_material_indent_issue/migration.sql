-- Stores Phase 3: Material Indent + Issue. Additive. One enum + two tables.
-- Issuing generates a STOCK_OUT at the service layer (reusing the existing
-- reservation-aware availability rule); no stored issued-quantity total —
-- indent status is derived from the issue notes.

CREATE TYPE "MaterialIndentStatus" AS ENUM (
  'OPEN', 'PARTIALLY_ISSUED', 'FULLY_ISSUED', 'CANCELLED'
);

CREATE TABLE "material_indents" (
  "id" TEXT NOT NULL,
  "indentNumber" TEXT NOT NULL,
  "status" "MaterialIndentStatus" NOT NULL DEFAULT 'OPEN',
  "projectKickoffId" TEXT,
  "itemId" TEXT NOT NULL,
  "requestedQuantity" DECIMAL(14,4) NOT NULL,
  "requiredByDate" TIMESTAMP(3),
  "notes" TEXT,
  "raisedById" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "material_indents_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "material_indents_indentNumber_key" ON "material_indents"("indentNumber");
CREATE INDEX "material_indents_status_idx" ON "material_indents"("status");
CREATE INDEX "material_indents_itemId_idx" ON "material_indents"("itemId");
CREATE INDEX "material_indents_projectKickoffId_idx" ON "material_indents"("projectKickoffId");

CREATE TABLE "material_issue_notes" (
  "id" TEXT NOT NULL,
  "minNumber" TEXT NOT NULL,
  "materialIndentId" TEXT NOT NULL,
  "itemId" TEXT NOT NULL,
  "storeLocationId" TEXT NOT NULL,
  "issuedQuantity" DECIMAL(14,4) NOT NULL,
  "binLocation" TEXT,
  "notes" TEXT,
  "issuedById" TEXT NOT NULL,
  "issuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "material_issue_notes_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "material_issue_notes_minNumber_key" ON "material_issue_notes"("minNumber");
CREATE INDEX "material_issue_notes_materialIndentId_idx" ON "material_issue_notes"("materialIndentId");
CREATE INDEX "material_issue_notes_itemId_idx" ON "material_issue_notes"("itemId");

ALTER TABLE "material_indents" ADD CONSTRAINT "material_indents_projectKickoffId_fkey"
  FOREIGN KEY ("projectKickoffId") REFERENCES "project_kickoffs"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "material_indents" ADD CONSTRAINT "material_indents_itemId_fkey"
  FOREIGN KEY ("itemId") REFERENCES "items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "material_indents" ADD CONSTRAINT "material_indents_raisedById_fkey"
  FOREIGN KEY ("raisedById") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "material_issue_notes" ADD CONSTRAINT "material_issue_notes_materialIndentId_fkey"
  FOREIGN KEY ("materialIndentId") REFERENCES "material_indents"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "material_issue_notes" ADD CONSTRAINT "material_issue_notes_itemId_fkey"
  FOREIGN KEY ("itemId") REFERENCES "items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "material_issue_notes" ADD CONSTRAINT "material_issue_notes_storeLocationId_fkey"
  FOREIGN KEY ("storeLocationId") REFERENCES "store_locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "material_issue_notes" ADD CONSTRAINT "material_issue_notes_issuedById_fkey"
  FOREIGN KEY ("issuedById") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
