-- Convert the vestigial String? link columns on design_requests / design_projects
-- into real foreign keys. Data verified before writing this migration: both
-- tables contain no non-null values in these columns (the UI never populated
-- them), so no backfill or cleanup is needed. If a stray orphan value did
-- exist, ADD CONSTRAINT would fail loudly and the migration would not apply.

-- AddForeignKey (design_requests)
ALTER TABLE "design_requests" ADD CONSTRAINT "design_requests_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "design_requests" ADD CONSTRAINT "design_requests_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "design_requests" ADD CONSTRAINT "design_requests_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "design_requests" ADD CONSTRAINT "design_requests_projectKickoffId_fkey" FOREIGN KEY ("projectKickoffId") REFERENCES "project_kickoffs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey (design_projects)
ALTER TABLE "design_projects" ADD CONSTRAINT "design_projects_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "design_projects" ADD CONSTRAINT "design_projects_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "design_projects" ADD CONSTRAINT "design_projects_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "design_projects" ADD CONSTRAINT "design_projects_projectKickoffId_fkey" FOREIGN KEY ("projectKickoffId") REFERENCES "project_kickoffs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- CreateIndex: the (orderId, productId) matching key PLM uses to find the
-- design project behind an NPD tracker.
CREATE INDEX "design_projects_orderId_productId_idx" ON "design_projects"("orderId", "productId");
