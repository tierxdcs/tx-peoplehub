-- Future approval steps are visible but not actionable until the prior step clears.
ALTER TYPE "PurchaseOrderApprovalStatus" ADD VALUE IF NOT EXISTS 'WAITING' BEFORE 'PENDING';
