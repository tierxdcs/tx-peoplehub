-- Logistics & Dispatch. Additive. Adds outbound final-QC clearance + derived
-- fulfilment status to Order, and the DeliveryChallan / DeliveryChallanLine
-- tables. No existing behaviour changes; new Order columns are nullable or
-- default to PENDING/NOT_DISPATCHED.

CREATE TYPE "OrderFinalQcStatus" AS ENUM ('PENDING', 'CLEARED');
CREATE TYPE "OrderFulfilmentStatus" AS ENUM ('NOT_DISPATCHED', 'PARTIALLY_DISPATCHED', 'FULLY_DISPATCHED');
CREATE TYPE "TransportMode" AS ENUM ('ROAD', 'RAIL', 'AIR', 'SEA', 'COURIER');
CREATE TYPE "DeliveryChallanStatus" AS ENUM ('DRAFT', 'DISPATCHED', 'IN_TRANSIT', 'DELIVERED', 'CANCELLED');

ALTER TABLE "orders"
  ADD COLUMN "finalQcStatus" "OrderFinalQcStatus" NOT NULL DEFAULT 'PENDING',
  ADD COLUMN "finalQcClearedById" TEXT,
  ADD COLUMN "finalQcClearedAt" TIMESTAMP(3),
  ADD COLUMN "fulfilmentStatus" "OrderFulfilmentStatus" NOT NULL DEFAULT 'NOT_DISPATCHED';

ALTER TABLE "orders" ADD CONSTRAINT "orders_finalQcClearedById_fkey"
  FOREIGN KEY ("finalQcClearedById") REFERENCES "employees"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "delivery_challans" (
  "id" TEXT NOT NULL,
  "dcNumber" TEXT NOT NULL,
  "orderId" TEXT NOT NULL,
  "customerId" TEXT NOT NULL,
  "status" "DeliveryChallanStatus" NOT NULL DEFAULT 'DRAFT',
  "customerPoReference" TEXT,
  "dispatchDate" TIMESTAMP(3) NOT NULL,
  "consigneeName" TEXT NOT NULL,
  "consigneeAddress" TEXT NOT NULL,
  "consigneeGstin" TEXT,
  "consigneeStateCode" TEXT NOT NULL,
  "transportMode" "TransportMode" NOT NULL,
  "transporterName" TEXT,
  "vehicleOrAwbNumber" TEXT,
  "driverName" TEXT,
  "driverPhone" TEXT,
  "specialDeliveryInstructions" TEXT,
  "documentsIncluded" JSONB,
  "promisedDeliveryDate" TIMESTAMP(3),
  "actualDeliveryDate" TIMESTAMP(3),
  "linkedInvoiceId" TEXT,
  "eWayBillNumber" TEXT,
  "eWayBillDate" TIMESTAMP(3),
  "eWayBillValidUntil" TIMESTAMP(3),
  "podFileKey" TEXT,
  "podReceivedBy" TEXT,
  "podNotes" TEXT,
  "createdById" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "delivery_challans_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "delivery_challans_dcNumber_key" ON "delivery_challans"("dcNumber");
CREATE UNIQUE INDEX "delivery_challans_linkedInvoiceId_key" ON "delivery_challans"("linkedInvoiceId");
CREATE INDEX "delivery_challans_orderId_idx" ON "delivery_challans"("orderId");
CREATE INDEX "delivery_challans_customerId_idx" ON "delivery_challans"("customerId");
CREATE INDEX "delivery_challans_status_idx" ON "delivery_challans"("status");

CREATE TABLE "delivery_challan_lines" (
  "id" TEXT NOT NULL,
  "deliveryChallanId" TEXT NOT NULL,
  "itemId" TEXT NOT NULL,
  "orderLineId" TEXT NOT NULL,
  "description" TEXT NOT NULL,
  "hsnCode" TEXT,
  "quantity" DECIMAL(14,4) NOT NULL,
  "unitOfMeasure" TEXT NOT NULL,
  "unitRate" DECIMAL(18,2) NOT NULL,
  "lineValue" DECIMAL(18,2) NOT NULL,
  "sequence" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "delivery_challan_lines_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "delivery_challan_lines_deliveryChallanId_idx" ON "delivery_challan_lines"("deliveryChallanId");
CREATE INDEX "delivery_challan_lines_orderLineId_idx" ON "delivery_challan_lines"("orderLineId");
CREATE INDEX "delivery_challan_lines_itemId_idx" ON "delivery_challan_lines"("itemId");

ALTER TABLE "delivery_challans" ADD CONSTRAINT "delivery_challans_orderId_fkey"
  FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "delivery_challans" ADD CONSTRAINT "delivery_challans_customerId_fkey"
  FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "delivery_challans" ADD CONSTRAINT "delivery_challans_linkedInvoiceId_fkey"
  FOREIGN KEY ("linkedInvoiceId") REFERENCES "sales_invoices"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "delivery_challans" ADD CONSTRAINT "delivery_challans_createdById_fkey"
  FOREIGN KEY ("createdById") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "delivery_challan_lines" ADD CONSTRAINT "delivery_challan_lines_deliveryChallanId_fkey"
  FOREIGN KEY ("deliveryChallanId") REFERENCES "delivery_challans"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "delivery_challan_lines" ADD CONSTRAINT "delivery_challan_lines_itemId_fkey"
  FOREIGN KEY ("itemId") REFERENCES "items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "delivery_challan_lines" ADD CONSTRAINT "delivery_challan_lines_orderLineId_fkey"
  FOREIGN KEY ("orderLineId") REFERENCES "order_line_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
