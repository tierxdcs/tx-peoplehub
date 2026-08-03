-- Ad-hoc bid line items: allow a line to be a placeholder (name/description
-- typed by the rep) with no real Product yet. productId becomes nullable and
-- two ad-hoc columns are added. The existing productId FK (ON DELETE RESTRICT)
-- remains valid for a nullable column. Purely additive — no data migration.

-- DropForeignKey (re-created below so the column can be made nullable)
ALTER TABLE "bid_line_items" DROP CONSTRAINT "bid_line_items_productId_fkey";

-- AlterTable
ALTER TABLE "bid_line_items" ALTER COLUMN "productId" DROP NOT NULL,
ADD COLUMN "adHocProductName" TEXT,
ADD COLUMN "adHocDescription" TEXT;

-- AddForeignKey
ALTER TABLE "bid_line_items" ADD CONSTRAINT "bid_line_items_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
