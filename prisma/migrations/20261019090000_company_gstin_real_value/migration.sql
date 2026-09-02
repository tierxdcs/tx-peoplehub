-- The supplier's GSTIN now prints on the face of every tax invoice (Rule
-- 46(a)-(b)) and already goes to the IRP in the e-invoice payload, so the
-- seeded placeholder identity would put a wrong GSTIN on a statutory document.
-- Set the real registered identity. PAN is characters 3-12 of the GSTIN and
-- must agree with it.
--
-- Data-only and idempotent: no schema change, and re-running is a no-op. There
-- is no UI for finance_company_settings, so a migration is the only way to
-- correct the row on every environment.
UPDATE "finance_company_settings"
SET "legalName" = 'Phaze Dynamics India Pvt Ltd',
    "gstin"     = '29AARCP3898H1ZG',
    "pan"       = 'AARCP3898H'
WHERE "id" = 'INDIA';
