CREATE TYPE "QmsCopqSource" AS ENUM ('SYSTEM_CALCULATED', 'MANUAL');
ALTER TABLE "qms_non_conformances" ADD COLUMN "costOfPoorQualitySource" "QmsCopqSource";
UPDATE "qms_non_conformances" SET "costOfPoorQualitySource" = 'MANUAL' WHERE "costOfPoorQuality" IS NOT NULL;
