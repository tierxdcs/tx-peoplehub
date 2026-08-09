CREATE TABLE "project_resource_plans" (
  "id" TEXT NOT NULL,
  "projectKickoffId" TEXT NOT NULL,
  "orderId" TEXT NOT NULL,
  "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "generatedById" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "project_resource_plans_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "project_resource_plan_lines" (
  "id" TEXT NOT NULL,
  "resourcePlanId" TEXT NOT NULL,
  "itemId" TEXT NOT NULL,
  "itemCode" TEXT NOT NULL,
  "itemName" TEXT NOT NULL,
  "requiredQuantity" DECIMAL(14,4) NOT NULL,
  "unitOfMeasure" TEXT NOT NULL,
  "benchmarkCostPerUnit" DECIMAL(14,2) NOT NULL,
  "negotiatedPricePerUnit" DECIMAL(14,2),
  "notes" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "project_resource_plan_lines_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "project_resource_plans_projectKickoffId_key" ON "project_resource_plans"("projectKickoffId");
CREATE INDEX "project_resource_plans_orderId_idx" ON "project_resource_plans"("orderId");

CREATE UNIQUE INDEX "project_resource_plan_lines_resourcePlanId_itemId_key" ON "project_resource_plan_lines"("resourcePlanId", "itemId");
CREATE INDEX "project_resource_plan_lines_resourcePlanId_idx" ON "project_resource_plan_lines"("resourcePlanId");
CREATE INDEX "project_resource_plan_lines_itemId_idx" ON "project_resource_plan_lines"("itemId");

ALTER TABLE "project_resource_plans" ADD CONSTRAINT "project_resource_plans_projectKickoffId_fkey" FOREIGN KEY ("projectKickoffId") REFERENCES "project_kickoffs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "project_resource_plans" ADD CONSTRAINT "project_resource_plans_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "project_resource_plans" ADD CONSTRAINT "project_resource_plans_generatedById_fkey" FOREIGN KEY ("generatedById") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "project_resource_plan_lines" ADD CONSTRAINT "project_resource_plan_lines_resourcePlanId_fkey" FOREIGN KEY ("resourcePlanId") REFERENCES "project_resource_plans"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "project_resource_plan_lines" ADD CONSTRAINT "project_resource_plan_lines_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
