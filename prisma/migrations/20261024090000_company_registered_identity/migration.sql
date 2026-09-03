-- Keep the statutory seller identity on tax invoices aligned with the
-- registered company identity and the address used on other outward-facing
-- documents. Bank details are document configuration and require no schema
-- change.
UPDATE "finance_company_settings"
SET "legalName"    = 'Phaze Dynamics Private Limited',
    "addressLine1" = '173, Industrial Suburb, 2nd Stage',
    "addressLine2" = 'Yeshwanthpur',
    "city"         = 'Bengaluru',
    "state"        = 'Karnataka',
    "stateCode"    = '29',
    "postalCode"   = '560022'
WHERE "id" = 'INDIA';
