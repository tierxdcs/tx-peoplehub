ALTER TABLE "verticals" ADD COLUMN "ownerId" TEXT;

CREATE INDEX "verticals_ownerId_idx" ON "verticals"("ownerId");

ALTER TABLE "verticals" ADD CONSTRAINT "verticals_ownerId_fkey"
FOREIGN KEY ("ownerId") REFERENCES "employees"("id") ON DELETE SET NULL ON UPDATE CASCADE;
