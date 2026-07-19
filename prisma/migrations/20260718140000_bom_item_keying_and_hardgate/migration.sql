-- Re-key BOM from Product to Item (enables genuine multi-level explosion), add
-- a Product->Item bridge, and add the ItemSupplier join for the release
-- hard-gate.
--
-- The BOM feature (boms/bom_lines/kickoff_bom_*) has never shipped — these
-- tables are empty in production — so re-keying `boms` by dropping the old
-- productId column and its dependent snapshots is non-destructive there. We
-- clear the empty snapshot/report tables first to satisfy FKs during the
-- column swap (no production data is affected).

-- Clear kickoff BOM snapshots (empty in prod; they reference boms.id which is fine,
-- but their selections copied product data we are not migrating). Safe: feature unshipped.
DELETE FROM "kickoff_bom_snapshot_lines";
DELETE FROM "kickoff_bom_selections";
DELETE FROM "kickoff_stock_reports";
DELETE FROM "bom_lines";
DELETE FROM "boms";

-- ── boms: productId -> itemId ────────────────────────────────────────────
ALTER TABLE "boms" DROP CONSTRAINT "boms_productId_fkey";
DROP INDEX "boms_productId_idx";
DROP INDEX "boms_productId_revisionNumber_key";
ALTER TABLE "boms" DROP COLUMN "productId";
ALTER TABLE "boms" ADD COLUMN "itemId" TEXT NOT NULL;
CREATE UNIQUE INDEX "boms_itemId_revisionNumber_key" ON "boms"("itemId", "revisionNumber");
CREATE INDEX "boms_itemId_idx" ON "boms"("itemId");
ALTER TABLE "boms" ADD CONSTRAINT "boms_itemId_fkey"
  FOREIGN KEY ("itemId") REFERENCES "items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ── products: add itemId bridge ──────────────────────────────────────────
ALTER TABLE "products" ADD COLUMN "itemId" TEXT;
CREATE INDEX "products_itemId_idx" ON "products"("itemId");
ALTER TABLE "products" ADD CONSTRAINT "products_itemId_fkey"
  FOREIGN KEY ("itemId") REFERENCES "items"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ── item_suppliers join ──────────────────────────────────────────────────
CREATE TABLE "item_suppliers" (
    "id" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "supplierPartNumber" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "item_suppliers_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "item_suppliers_itemId_supplierId_key" ON "item_suppliers"("itemId", "supplierId");
CREATE INDEX "item_suppliers_itemId_idx" ON "item_suppliers"("itemId");
CREATE INDEX "item_suppliers_supplierId_idx" ON "item_suppliers"("supplierId");
ALTER TABLE "item_suppliers" ADD CONSTRAINT "item_suppliers_itemId_fkey"
  FOREIGN KEY ("itemId") REFERENCES "items"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "item_suppliers" ADD CONSTRAINT "item_suppliers_supplierId_fkey"
  FOREIGN KEY ("supplierId") REFERENCES "suppliers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "item_suppliers" ADD CONSTRAINT "item_suppliers_createdById_fkey"
  FOREIGN KEY ("createdById") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
