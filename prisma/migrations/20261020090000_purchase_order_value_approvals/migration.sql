-- Value-based, sequential Purchase Order approval ladder.
ALTER TYPE "PurchaseOrderStatus" ADD VALUE IF NOT EXISTS 'PENDING_CSCO_APPROVAL' BEFORE 'PENDING_CEO_APPROVAL';
ALTER TYPE "PurchaseOrderStatus" ADD VALUE IF NOT EXISTS 'PENDING_COO_APPROVAL' BEFORE 'PENDING_CEO_APPROVAL';
ALTER TYPE "PurchaseOrderStatus" ADD VALUE IF NOT EXISTS 'APPROVED' AFTER 'PENDING_CEO_APPROVAL';

CREATE TYPE "PurchaseOrderApprovalLevel" AS ENUM ('CSCO', 'COO', 'CEO');
CREATE TYPE "PurchaseOrderApprovalStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

ALTER TABLE "purchase_orders" ADD COLUMN "approvalAmount" DECIMAL(18,2);

CREATE TABLE "purchase_order_approvals" (
    "id" TEXT NOT NULL,
    "purchaseOrderId" TEXT NOT NULL,
    "level" "PurchaseOrderApprovalLevel" NOT NULL,
    "sequence" INTEGER NOT NULL,
    "status" "PurchaseOrderApprovalStatus" NOT NULL DEFAULT 'PENDING',
    "amountSnapshot" DECIMAL(18,2) NOT NULL,
    "decidedById" TEXT,
    "decidedAt" TIMESTAMP(3),
    "comment" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "purchase_order_approvals_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "purchase_order_approvals_purchaseOrderId_level_key" ON "purchase_order_approvals"("purchaseOrderId", "level");
CREATE UNIQUE INDEX "purchase_order_approvals_purchaseOrderId_sequence_key" ON "purchase_order_approvals"("purchaseOrderId", "sequence");
CREATE INDEX "purchase_order_approvals_level_status_idx" ON "purchase_order_approvals"("level", "status");

ALTER TABLE "purchase_order_approvals" ADD CONSTRAINT "purchase_order_approvals_purchaseOrderId_fkey" FOREIGN KEY ("purchaseOrderId") REFERENCES "purchase_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "purchase_order_approvals" ADD CONSTRAINT "purchase_order_approvals_decidedById_fkey" FOREIGN KEY ("decidedById") REFERENCES "employees"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Existing unissued records re-enter as editable drafts and use the new ladder.
UPDATE "purchase_orders"
SET "status" = 'DRAFT'
WHERE "status" = 'PENDING_CEO_APPROVAL';
