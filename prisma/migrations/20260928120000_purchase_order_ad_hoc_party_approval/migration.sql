ALTER TYPE "PurchaseOrderStatus" ADD VALUE IF NOT EXISTS 'PENDING_CEO_APPROVAL' BEFORE 'DRAFT';
ALTER TYPE "PurchaseOrderStatus" ADD VALUE IF NOT EXISTS 'REJECTED' BEFORE 'CANCELLED';

ALTER TABLE "purchase_orders"
  ADD COLUMN "adHocPartyName" TEXT,
  ADD COLUMN "adHocContactInfo" TEXT,
  ADD COLUMN "adHocPartyAddress" TEXT,
  ADD COLUMN "ceoApprovedById" TEXT,
  ADD COLUMN "ceoApprovedAt" TIMESTAMP(3),
  ADD COLUMN "rejectedById" TEXT,
  ADD COLUMN "rejectedAt" TIMESTAMP(3),
  ADD COLUMN "rejectionComment" TEXT;

ALTER TABLE "purchase_orders" DROP CONSTRAINT "purchase_orders_exactly_one_partner";
ALTER TABLE "purchase_orders"
  ADD CONSTRAINT "purchase_orders_at_most_one_partner"
  CHECK (("supplierId" IS NOT NULL)::int + ("vendorId" IS NOT NULL)::int <= 1);

ALTER TABLE "purchase_orders"
  ADD CONSTRAINT "purchase_orders_ad_hoc_party_name_required"
  CHECK ("supplierId" IS NOT NULL OR "vendorId" IS NOT NULL OR length(btrim("adHocPartyName")) > 0);
