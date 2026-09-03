-- PO advance payments: SCM commits an advance on the purchase order, Accounts
-- pays it, and the confirmation finds its way back to SCM.
--
-- The accounting already existed (an unallocated AccountsPayablePayment posts to
-- 1500 "Advances to vendors" and TreasuryService.applyAdvance later relieves it).
-- What was missing was the commitment on the PO, a link from the payment back to
-- the PO that caused it, and the two notifications that close the loop.

-- The advance commitment. Percentage of the pre-tax line total; the rupee value
-- is snapshotted at issue so the printed PO, the request Accounts received and
-- the number on screen cannot drift apart.
ALTER TABLE "purchase_orders"
  ADD COLUMN "advancePercent" DECIMAL(5, 2),
  ADD COLUMN "advanceAmount" DECIMAL(18, 2);

-- Traceability from the money back to the commitment. Nullable — every existing
-- payment predates this and is correctly left unlinked. ON DELETE RESTRICT: a PO
-- that has moved real cash must not be deletable.
ALTER TABLE "accounts_payable_payments"
  ADD COLUMN "purchaseOrderId" TEXT;

ALTER TABLE "accounts_payable_payments"
  ADD CONSTRAINT "accounts_payable_payments_purchaseOrderId_fkey"
  FOREIGN KEY ("purchaseOrderId") REFERENCES "purchase_orders"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX "accounts_payable_payments_purchaseOrderId_idx"
  ON "accounts_payable_payments"("purchaseOrderId");

-- The handoff notifications. Three types, not two: a silently refused advance is
-- the exact failure mode this handoff exists to prevent.
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'PO_ADVANCE_PAYMENT_REQUESTED';
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'PO_ADVANCE_PAYMENT_PAID';
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'PO_ADVANCE_PAYMENT_REJECTED';

-- Deep-link target, following the existing "at most one related-entity id, by
-- type" convention on this table. Cascade matches the other five related-* FKs.
ALTER TABLE "notifications"
  ADD COLUMN "relatedPurchaseOrderId" TEXT;

ALTER TABLE "notifications"
  ADD CONSTRAINT "notifications_relatedPurchaseOrderId_fkey"
  FOREIGN KEY ("relatedPurchaseOrderId") REFERENCES "purchase_orders"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

CREATE INDEX "notifications_relatedPurchaseOrderId_idx"
  ON "notifications"("relatedPurchaseOrderId");
