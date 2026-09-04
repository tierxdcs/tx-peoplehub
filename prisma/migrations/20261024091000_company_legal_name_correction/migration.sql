-- Correct the registered legal entity name used on statutory and commercial
-- documents. Kept as a separate migration because the preceding identity
-- migration may already have been deployed.
UPDATE "finance_company_settings"
SET "legalName" = 'Phaze Dynamics India Private Limited'
WHERE "id" = 'INDIA';
