-- Incoming (GRN) QC inspection against a QMS question template.
--
-- 1. qms_inspections gains grnLineId: incoming inspection is per received ITEM,
--    not per consignment, so one GRN with three items produces three
--    inspections. Loose reference (no FK), matching the existing grnId column.
-- 2. Seeds ONE approved INCOMING template so the QC gate is usable on day one.
--    Idempotent: re-running skips the insert if INC-GEN already exists. Both
--    createdById and approvedById are 'system' — those columns carry no FK, and
--    a seeded template must not be attributed to a real person who never
--    authored or approved it. Edit or replace it in QMS -> Templates; revising
--    there bumps the version and existing inspections keep their frozen
--    templateSnapshot.

ALTER TABLE "qms_inspections" ADD COLUMN "grnLineId" TEXT;

CREATE INDEX "qms_inspections_grnLineId_idx" ON "qms_inspections"("grnLineId");

INSERT INTO "qms_question_templates" (
  "id", "templateCode", "name", "description", "templateType", "version",
  "status", "effectiveFrom", "createdById", "approvedById", "approvedAt",
  "createdAt", "updatedAt"
)
SELECT
  'seed-tpl-inc-gen-v1',
  'INC-GEN',
  'Incoming Material Inspection — General',
  'Default checklist applied to material arriving against a purchase order. Replace or extend with the item-specific checks your process requires.',
  'INCOMING',
  1,
  'APPROVED',
  now(),
  'system',
  'system',
  now(),
  now(),
  now()
WHERE NOT EXISTS (
  SELECT 1 FROM "qms_question_templates" WHERE "templateCode" = 'INC-GEN'
);

INSERT INTO "qms_template_questions" (
  "id", "templateId", "section", "sequence", "prompt", "responseType",
  "required", "weight", "unit", "lowerLimit", "upperLimit", "options",
  "acceptanceCriteria", "evidenceOnFailure"
)
SELECT * FROM (VALUES
  ('seed-q-inc-gen-1', 'seed-tpl-inc-gen-v1', 'Receipt', 1,
   'Packaging intact, no transit damage', 'YES_NO_NA'::"QmsResponseType", true, 1.00,
   NULL::text, NULL::numeric, NULL::numeric, NULL::jsonb,
   'Outer packing undamaged and seals unbroken', true),
  ('seed-q-inc-gen-2', 'seed-tpl-inc-gen-v1', 'Receipt', 2,
   'Quantity matches delivery challan and purchase order', 'YES_NO_NA'::"QmsResponseType", true, 1.00,
   NULL::text, NULL::numeric, NULL::numeric, NULL::jsonb,
   'Counted quantity agrees with the challan', true),
  ('seed-q-inc-gen-3', 'seed-tpl-inc-gen-v1', 'Inspection', 3,
   'Visual / dimensional check against drawing or specification', 'PASS_FAIL_NA'::"QmsResponseType", true, 2.00,
   NULL::text, NULL::numeric, NULL::numeric, NULL::jsonb,
   'Conforms to the released drawing revision', true),
  ('seed-q-inc-gen-4', 'seed-tpl-inc-gen-v1', 'Documentation', 4,
   'Material test certificate / test report attached', 'YES_NO_NA'::"QmsResponseType", true, 1.00,
   NULL::text, NULL::numeric, NULL::numeric, NULL::jsonb,
   'Certificate supplied and traceable to the lot', true),
  ('seed-q-inc-gen-5', 'seed-tpl-inc-gen-v1', 'Documentation', 5,
   'Part marking / identification legible', 'YES_NO_NA'::"QmsResponseType", true, 1.00,
   NULL::text, NULL::numeric, NULL::numeric, NULL::jsonb,
   'Part number and lot identification readable', false),
  ('seed-q-inc-gen-6', 'seed-tpl-inc-gen-v1', 'Inspection', 6,
   'Inspector observations', 'TEXT'::"QmsResponseType", false, 1.00,
   NULL::text, NULL::numeric, NULL::numeric, NULL::jsonb,
   NULL, false)
) AS q
WHERE EXISTS (
  SELECT 1 FROM "qms_question_templates"
  WHERE "id" = 'seed-tpl-inc-gen-v1'
) AND NOT EXISTS (
  SELECT 1 FROM "qms_template_questions"
  WHERE "templateId" = 'seed-tpl-inc-gen-v1'
);
