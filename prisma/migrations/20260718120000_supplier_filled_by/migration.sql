-- Supplier Qualification — internal-fill option. Track how a questionnaire
-- reached SUBMITTED: EXTERNAL_SUPPLIER (public token form) vs INTERNAL_STAFF
-- (SCM staff filling it directly in-app). Null until submitted.

CREATE TYPE "SupplierFilledBy" AS ENUM ('EXTERNAL_SUPPLIER', 'INTERNAL_STAFF');

ALTER TABLE "supplier_questionnaires" ADD COLUMN "filledBy" "SupplierFilledBy";
