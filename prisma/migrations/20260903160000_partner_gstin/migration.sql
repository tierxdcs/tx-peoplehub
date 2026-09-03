ALTER TABLE "vendors" ADD COLUMN "gstin" TEXT;
ALTER TABLE "suppliers" ADD COLUMN "gstin" TEXT;

CREATE UNIQUE INDEX "vendors_gstin_key" ON "vendors"("gstin");
CREATE UNIQUE INDEX "suppliers_gstin_key" ON "suppliers"("gstin");
