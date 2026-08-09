-- Annual CTC hiring budget (INR) for a candidate requisition. Nullable in the
-- DB so the column can be added to existing rows, but REQUIRED in the create
-- DTO/service for every new requisition (the repo enforces such invariants in
-- application code, not with DB constraints). Purely additive — no data
-- migration.
ALTER TABLE "candidate_requisitions" ADD COLUMN "budgetAnnualCtc" DECIMAL(14,2);
