CREATE TYPE "CustomerBomIntakeStatus" AS ENUM ('DRAFT', 'CREATED');

CREATE TABLE "customer_bom_intakes" (
  "id" TEXT NOT NULL,
  "opportunityId" TEXT NOT NULL,
  "businessUnitId" TEXT NOT NULL,
  "productName" TEXT NOT NULL,
  "unitOfMeasure" TEXT NOT NULL DEFAULT 'each',
  "rawFileKey" TEXT NOT NULL,
  "rawFileName" TEXT NOT NULL,
  "rawFileSize" INTEGER NOT NULL,
  "rawMimeType" TEXT NOT NULL,
  "status" "CustomerBomIntakeStatus" NOT NULL DEFAULT 'DRAFT',
  "finishedGoodItemId" TEXT,
  "productId" TEXT,
  "bomId" TEXT,
  "createdById" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "customer_bom_intakes_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "customer_bom_intake_lines" (
  "id" TEXT NOT NULL,
  "intakeId" TEXT NOT NULL,
  "description" TEXT NOT NULL,
  "customerPartReference" TEXT,
  "quantity" DECIMAL(14,4) NOT NULL,
  "unitOfMeasure" TEXT NOT NULL,
  "resolvedItemId" TEXT NOT NULL,
  "createdNewItem" BOOLEAN NOT NULL DEFAULT false,
  "fuzzyCandidates" JSONB,
  "sequence" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "customer_bom_intake_lines_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "customer_bom_intakes_finishedGoodItemId_key" ON "customer_bom_intakes"("finishedGoodItemId");
CREATE UNIQUE INDEX "customer_bom_intakes_productId_key" ON "customer_bom_intakes"("productId");
CREATE UNIQUE INDEX "customer_bom_intakes_bomId_key" ON "customer_bom_intakes"("bomId");
CREATE INDEX "customer_bom_intakes_opportunityId_idx" ON "customer_bom_intakes"("opportunityId");
CREATE INDEX "customer_bom_intakes_status_idx" ON "customer_bom_intakes"("status");
CREATE INDEX "customer_bom_intake_lines_intakeId_idx" ON "customer_bom_intake_lines"("intakeId");
CREATE INDEX "customer_bom_intake_lines_resolvedItemId_idx" ON "customer_bom_intake_lines"("resolvedItemId");

ALTER TABLE "customer_bom_intakes" ADD CONSTRAINT "customer_bom_intakes_opportunityId_fkey" FOREIGN KEY ("opportunityId") REFERENCES "opportunities"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "customer_bom_intakes" ADD CONSTRAINT "customer_bom_intakes_businessUnitId_fkey" FOREIGN KEY ("businessUnitId") REFERENCES "business_units"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "customer_bom_intakes" ADD CONSTRAINT "customer_bom_intakes_finishedGoodItemId_fkey" FOREIGN KEY ("finishedGoodItemId") REFERENCES "items"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "customer_bom_intakes" ADD CONSTRAINT "customer_bom_intakes_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "customer_bom_intakes" ADD CONSTRAINT "customer_bom_intakes_bomId_fkey" FOREIGN KEY ("bomId") REFERENCES "boms"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "customer_bom_intakes" ADD CONSTRAINT "customer_bom_intakes_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "customer_bom_intake_lines" ADD CONSTRAINT "customer_bom_intake_lines_intakeId_fkey" FOREIGN KEY ("intakeId") REFERENCES "customer_bom_intakes"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "customer_bom_intake_lines" ADD CONSTRAINT "customer_bom_intake_lines_resolvedItemId_fkey" FOREIGN KEY ("resolvedItemId") REFERENCES "items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "rfqs" ADD COLUMN "customerBomIntakeId" TEXT;
CREATE INDEX "rfqs_customerBomIntakeId_idx" ON "rfqs"("customerBomIntakeId");
ALTER TABLE "rfqs" ADD CONSTRAINT "rfqs_customerBomIntakeId_fkey" FOREIGN KEY ("customerBomIntakeId") REFERENCES "customer_bom_intakes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "item_quoted_costs" (
    "id" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "rfqId" TEXT NOT NULL,
    "quoteLineId" TEXT NOT NULL,
    "unitPrice" DECIMAL(18,2) NOT NULL,
    "awardedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "item_quoted_costs_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "item_quoted_costs_quoteLineId_key" ON "item_quoted_costs"("quoteLineId");
CREATE INDEX "item_quoted_costs_itemId_awardedAt_idx" ON "item_quoted_costs"("itemId", "awardedAt");
CREATE INDEX "item_quoted_costs_rfqId_idx" ON "item_quoted_costs"("rfqId");
ALTER TABLE "item_quoted_costs" ADD CONSTRAINT "item_quoted_costs_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "items"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "item_quoted_costs" ADD CONSTRAINT "item_quoted_costs_rfqId_fkey" FOREIGN KEY ("rfqId") REFERENCES "rfqs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "item_quoted_costs" ADD CONSTRAINT "item_quoted_costs_quoteLineId_fkey" FOREIGN KEY ("quoteLineId") REFERENCES "rfq_quote_lines"("id") ON DELETE CASCADE ON UPDATE CASCADE;
