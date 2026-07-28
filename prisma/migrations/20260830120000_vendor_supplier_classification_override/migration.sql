-- SuperAdmin classification override for Vendor and Supplier audits.
-- The computed classification is never stored; the override is stored alongside
-- the scores and, when set, propagates to Vendor.status / Supplier.status.
-- `statusOverridden` denormalizes "current status came from an override" onto
-- the master record so every list/picker reading `status` can show it.

-- Vendor master flag
ALTER TABLE "vendors" ADD COLUMN "statusOverridden" BOOLEAN NOT NULL DEFAULT false;

-- Vendor audit override fields
ALTER TABLE "vendor_audits" ADD COLUMN "overrideClassification" "VendorStatus";
ALTER TABLE "vendor_audits" ADD COLUMN "overrideReason" TEXT;
ALTER TABLE "vendor_audits" ADD COLUMN "overriddenById" TEXT;
ALTER TABLE "vendor_audits" ADD COLUMN "overriddenAt" TIMESTAMP(3);

ALTER TABLE "vendor_audits" ADD CONSTRAINT "vendor_audits_overriddenById_fkey" FOREIGN KEY ("overriddenById") REFERENCES "employees"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Supplier master flag
ALTER TABLE "suppliers" ADD COLUMN "statusOverridden" BOOLEAN NOT NULL DEFAULT false;

-- Supplier audit override fields
ALTER TABLE "supplier_audits" ADD COLUMN "overrideClassification" "SupplierStatus";
ALTER TABLE "supplier_audits" ADD COLUMN "overrideReason" TEXT;
ALTER TABLE "supplier_audits" ADD COLUMN "overriddenById" TEXT;
ALTER TABLE "supplier_audits" ADD COLUMN "overriddenAt" TIMESTAMP(3);

ALTER TABLE "supplier_audits" ADD CONSTRAINT "supplier_audits_overriddenById_fkey" FOREIGN KEY ("overriddenById") REFERENCES "employees"("id") ON DELETE SET NULL ON UPDATE CASCADE;
