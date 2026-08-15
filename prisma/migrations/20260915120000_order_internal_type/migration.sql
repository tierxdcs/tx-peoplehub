-- Internal Orders: design-to-dispatch tracking without a customer commitment.
-- Additive and backfill-free: existing rows default to CUSTOMER; customerId is
-- relaxed to nullable so INTERNAL orders may carry only a prospective customer
-- (or none). The FK to customers is unchanged (still ON DELETE RESTRICT).

-- CreateEnum
CREATE TYPE "OrderType" AS ENUM ('CUSTOMER', 'INTERNAL');

-- AlterTable
ALTER TABLE "orders"
  ADD COLUMN "orderType" "OrderType" NOT NULL DEFAULT 'CUSTOMER',
  ALTER COLUMN "customerId" DROP NOT NULL;
