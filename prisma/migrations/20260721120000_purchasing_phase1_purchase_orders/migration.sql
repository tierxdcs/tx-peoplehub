-- Stores Phase 1: Purchase Orders. New enum + two tables. Additive; no changes
-- to existing tables beyond new FKs referencing employees/suppliers/vendors/items.
-- Exactly-one-of supplier/vendor is enforced by a CHECK constraint (in addition
-- to the service-layer guard). No receivedQuantity column anywhere by design.

CREATE TYPE "PurchaseOrderStatus" AS ENUM (
  'DRAFT', 'ISSUED', 'PARTIALLY_RECEIVED', 'FULLY_RECEIVED', 'CANCELLED'
);

CREATE TABLE "purchase_orders" (
  "id" TEXT NOT NULL,
  "poNumber" TEXT NOT NULL,
  "status" "PurchaseOrderStatus" NOT NULL DEFAULT 'DRAFT',
  "supplierId" TEXT,
  "vendorId" TEXT,
  "orderDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expectedDeliveryDate" TIMESTAMP(3),
  "notes" TEXT,
  "createdById" TEXT NOT NULL,
  "issuedAt" TIMESTAMP(3),
  "cancelledAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "purchase_orders_pkey" PRIMARY KEY ("id"),
  -- Exactly one trading partner: precisely one of supplierId / vendorId is set.
  CONSTRAINT "purchase_orders_exactly_one_partner"
    CHECK (("supplierId" IS NOT NULL)::int + ("vendorId" IS NOT NULL)::int = 1)
);

CREATE UNIQUE INDEX "purchase_orders_poNumber_key" ON "purchase_orders"("poNumber");
CREATE INDEX "purchase_orders_status_idx" ON "purchase_orders"("status");
CREATE INDEX "purchase_orders_supplierId_idx" ON "purchase_orders"("supplierId");
CREATE INDEX "purchase_orders_vendorId_idx" ON "purchase_orders"("vendorId");

CREATE TABLE "purchase_order_lines" (
  "id" TEXT NOT NULL,
  "purchaseOrderId" TEXT NOT NULL,
  "itemId" TEXT NOT NULL,
  "orderedQuantity" DECIMAL(14,4) NOT NULL,
  "unitPrice" DECIMAL(14,2) NOT NULL,
  "unitOfMeasure" TEXT NOT NULL,
  "lineTotal" DECIMAL(14,2) NOT NULL,
  "notes" TEXT,
  "sequence" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "purchase_order_lines_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "purchase_order_lines_purchaseOrderId_idx" ON "purchase_order_lines"("purchaseOrderId");
CREATE INDEX "purchase_order_lines_itemId_idx" ON "purchase_order_lines"("itemId");

ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_supplierId_fkey"
  FOREIGN KEY ("supplierId") REFERENCES "suppliers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_vendorId_fkey"
  FOREIGN KEY ("vendorId") REFERENCES "vendors"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_createdById_fkey"
  FOREIGN KEY ("createdById") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "purchase_order_lines" ADD CONSTRAINT "purchase_order_lines_purchaseOrderId_fkey"
  FOREIGN KEY ("purchaseOrderId") REFERENCES "purchase_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "purchase_order_lines" ADD CONSTRAINT "purchase_order_lines_itemId_fkey"
  FOREIGN KEY ("itemId") REFERENCES "items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
