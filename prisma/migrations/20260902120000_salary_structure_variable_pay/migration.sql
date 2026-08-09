-- Annual variable/performance pay: an indirect CTC component, not a monthly
-- earning. Nullable (treated as 0 when absent), same as otherAllowances.
ALTER TABLE "salary_structures" ADD COLUMN "variablePay" DECIMAL(14,2);
