-- Renumber human-readable employee codes from `EMP-####` to `PHB{YY}-{NNN}`,
-- where YY is the 2-digit calendar year the employee joined (createdAt) and NNN
-- is a per-year sequence that restarts at 001 each year — e.g. PHB26-001.
--
-- This is safe to run in place: Employee.employeeId is a DISPLAY-ONLY code.
-- Every foreign key in the schema references the UUID primary key (Employee.id),
-- never this string, and nothing parses/validates the `EMP-` format. The new
-- values share no prefix with the old ones and are unique per (year, sequence),
-- so there is no collision with existing or with each other.

-- 1) Rename every employee. Sequence is assigned per joining-year, ordered by
--    joining time (createdAt) with the old code as a stable tiebreak, so the
--    established order is preserved (the earliest hire of a year becomes -001).
WITH numbered AS (
  SELECT
    id,
    EXTRACT(YEAR FROM "createdAt")::int AS yr,
    ROW_NUMBER() OVER (
      PARTITION BY EXTRACT(YEAR FROM "createdAt")::int
      ORDER BY "createdAt" ASC, "employeeId" ASC
    ) AS seq
  FROM "employees"
)
UPDATE "employees" e
SET "employeeId" =
  'PHB' || LPAD((n.yr % 100)::text, 2, '0') || '-' || LPAD(n.seq::text, 3, '0')
FROM numbered n
WHERE e.id = n.id;

-- 2) Advance the year-scoped counter (the same `sales_sequences` table the
--    runtime allocator now uses, keyed by entity='employee') so the NEXT hire in
--    each year continues after the highest backfilled sequence. The max sequence
--    used for a year equals the count of employees who joined that year, so this
--    is independent of the ordering above. GREATEST guards the (unexpected) case
--    where a counter row already sits higher.
INSERT INTO "sales_sequences" ("entity", "year", "lastValue", "updatedAt")
SELECT 'employee', EXTRACT(YEAR FROM "createdAt")::int, COUNT(*)::int, now()
FROM "employees"
GROUP BY EXTRACT(YEAR FROM "createdAt")::int
ON CONFLICT ("entity", "year")
DO UPDATE SET "lastValue" = GREATEST("sales_sequences"."lastValue", EXCLUDED."lastValue"),
              "updatedAt" = now();

-- Note: the old `employee_id_seq` Postgres sequence is now unused (the app and
-- seed allocate from `sales_sequences`). It is left in place — harmless, and
-- dropping it is unnecessary for this change.
