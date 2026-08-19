-- Defaults are effective-dated and remain replaceable through Statutory Config.
-- Existing customer-entered rows win: each insert runs only when that config
-- type/state has never been configured.
INSERT INTO "statutory_configs"
  ("id", "configType", "state", "effectiveFrom", "effectiveTo", "configData", "sourceNote", "createdAt", "updatedAt")
SELECT
  gen_random_uuid(), 'SALARY_STRUCTURE', NULL, DATE '2026-04-01', NULL,
  '{"basicGrossRate":0.60,"hraGrossRate":0.32,"conveyanceMonthly":500,"annualInsurance":8940,"incentiveGrossMonths":1}'::jsonb,
  'Company-confirmed onboarding salary structure defaults; review through Statutory Config before production payroll.',
  CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
WHERE NOT EXISTS (
  SELECT 1 FROM "statutory_configs" WHERE "configType" = 'SALARY_STRUCTURE'
);

INSERT INTO "statutory_configs"
  ("id", "configType", "state", "effectiveFrom", "effectiveTo", "configData", "sourceNote", "createdAt", "updatedAt")
SELECT
  gen_random_uuid(), 'PF', NULL, DATE '2026-04-01', NULL,
  '{"employeeRate":0.12,"employerRate":0.13,"epsRate":0.0833,"wageCeiling":15000,"adminCharge":0.005}'::jsonb,
  'Default based on EPFO employer guidance; must be verified by payroll compliance before production use.',
  CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
WHERE NOT EXISTS (
  SELECT 1 FROM "statutory_configs" WHERE "configType" = 'PF'
);

INSERT INTO "statutory_configs"
  ("id", "configType", "state", "effectiveFrom", "effectiveTo", "configData", "sourceNote", "createdAt", "updatedAt")
SELECT
  gen_random_uuid(), 'ESI', NULL, DATE '2026-04-01', NULL,
  '{"employeeRate":0.0075,"employerRate":0.0325,"wageThreshold":21000}'::jsonb,
  'Default based on ESIC published contribution rates and wage threshold; verify before production use.',
  CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
WHERE NOT EXISTS (
  SELECT 1 FROM "statutory_configs" WHERE "configType" = 'ESI'
);

INSERT INTO "statutory_configs"
  ("id", "configType", "state", "effectiveFrom", "effectiveTo", "configData", "sourceNote", "createdAt", "updatedAt")
SELECT
  gen_random_uuid(), 'PROFESSIONAL_TAX', 'Karnataka', DATE '2026-04-01', NULL,
  '{"slabs":[{"slabFrom":0,"slabTo":24999.99,"amount":0},{"slabFrom":25000,"slabTo":null,"amount":200}]}'::jsonb,
  'Company-confirmed Karnataka onboarding slab; validate with payroll advisor when statutory rates change.',
  CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
WHERE NOT EXISTS (
  SELECT 1 FROM "statutory_configs"
  WHERE "configType" = 'PROFESSIONAL_TAX' AND "state" = 'Karnataka'
);
