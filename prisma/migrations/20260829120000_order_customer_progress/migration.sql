-- Customer-facing, privacy-safe order progress links and immutable receipt
-- acknowledgements. Existing Orders/PLM/POD data is not modified.
ALTER TYPE "NotificationType" ADD VALUE 'CUSTOMER_DELIVERY_SIGNOFF';

CREATE TABLE "order_customer_progress_invites" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "passwordHash" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "order_customer_progress_invites_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "order_customer_signoffs" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "inviteId" TEXT NOT NULL,
    "customerName" TEXT NOT NULL,
    "designation" TEXT NOT NULL,
    "receiptConfirmed" BOOLEAN NOT NULL,
    "comments" TEXT,
    "satisfactionRating" INTEGER,
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "order_customer_signoffs_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "order_customer_signoffs_rating_check"
      CHECK ("satisfactionRating" IS NULL OR ("satisfactionRating" BETWEEN 1 AND 5)),
    CONSTRAINT "order_customer_signoffs_receipt_check"
      CHECK ("receiptConfirmed" = TRUE)
);

CREATE UNIQUE INDEX "order_customer_progress_invites_token_key"
  ON "order_customer_progress_invites"("token");
CREATE INDEX "order_customer_progress_invites_orderId_idx"
  ON "order_customer_progress_invites"("orderId");
CREATE UNIQUE INDEX "order_customer_signoffs_orderId_key"
  ON "order_customer_signoffs"("orderId");
CREATE UNIQUE INDEX "order_customer_signoffs_inviteId_key"
  ON "order_customer_signoffs"("inviteId");

ALTER TABLE "order_customer_progress_invites"
  ADD CONSTRAINT "order_customer_progress_invites_orderId_fkey"
  FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "order_customer_progress_invites"
  ADD CONSTRAINT "order_customer_progress_invites_createdById_fkey"
  FOREIGN KEY ("createdById") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "order_customer_signoffs"
  ADD CONSTRAINT "order_customer_signoffs_orderId_fkey"
  FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "order_customer_signoffs"
  ADD CONSTRAINT "order_customer_signoffs_inviteId_fkey"
  FOREIGN KEY ("inviteId") REFERENCES "order_customer_progress_invites"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
