ALTER TYPE "NotificationType" ADD VALUE 'PLM_DESIGN_REVIEW_REQUESTED';
ALTER TYPE "NotificationType" ADD VALUE 'PLM_DESIGN_REVIEW_DECIDED';
ALTER TYPE "NotificationType" ADD VALUE 'PLM_STAGE_ADVANCED';
ALTER TYPE "NotificationType" ADD VALUE 'PLM_PRODUCTION_UPDATE';

ALTER TABLE "notifications" ADD COLUMN "relatedPlmTrackerId" TEXT;
CREATE INDEX "notifications_relatedPlmTrackerId_idx" ON "notifications"("relatedPlmTrackerId");
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_relatedPlmTrackerId_fkey" FOREIGN KEY ("relatedPlmTrackerId") REFERENCES "plm_trackers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
