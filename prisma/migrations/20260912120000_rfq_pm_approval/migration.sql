-- Project Manager approval gate for RFQs. Additive and nullable-safe: existing
-- RFQs get NULL approval fields, so they read as "awaiting approval" and cannot
-- be issued until a PM (Employee.isProjectManager) or SUPER_ADMIN approves. The
-- FK is ON DELETE SET NULL so removing an employee never blocks an RFQ. Nothing
-- here touches any other table; the unrelated plm_trackers default drift is
-- deliberately excluded.
ALTER TABLE "rfqs" ADD COLUMN     "pmApprovedAt" TIMESTAMP(3),
ADD COLUMN     "pmApprovedById" TEXT,
ADD COLUMN     "pmRejectionComment" TEXT;

ALTER TABLE "rfqs" ADD CONSTRAINT "rfqs_pmApprovedById_fkey" FOREIGN KEY ("pmApprovedById") REFERENCES "employees"("id") ON DELETE SET NULL ON UPDATE CASCADE;
