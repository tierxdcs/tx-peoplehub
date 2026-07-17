-- Deep-link target for vendor-based notifications (SCM). Nullable/additive —
-- card notifications keep relatedCardId; vendor ones use relatedVendorId.
ALTER TABLE "notifications" ADD COLUMN "relatedVendorId" TEXT;
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_relatedVendorId_fkey" FOREIGN KEY ("relatedVendorId") REFERENCES "vendors"("id") ON DELETE CASCADE ON UPDATE CASCADE;
