CREATE TYPE "VendorCoreCompetency" AS ENUM (
  'SHEET_METAL',
  'FABRICATION',
  'PDU_MANUFACTURER',
  'MODULAR_DATA_CENTER',
  'ELECTRICAL_PANELS',
  'PRECISION_MACHINING',
  'POWDER_COATING_SURFACE_FINISHING',
  'CABLE_HARNESS',
  'HVAC_COOLING',
  'SYSTEM_INTEGRATION',
  'OTHER'
);

ALTER TABLE "vendors" ADD COLUMN "coreCompetency" "VendorCoreCompetency";
ALTER TABLE "vendor_audits" ADD COLUMN "coreCompetency" "VendorCoreCompetency";
CREATE INDEX "vendors_coreCompetency_idx" ON "vendors"("coreCompetency");
