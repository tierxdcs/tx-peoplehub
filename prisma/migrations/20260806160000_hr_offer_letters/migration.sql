ALTER TABLE "employees" ADD COLUMN "territory" TEXT;

CREATE TABLE "offer_letters" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "referenceNumber" TEXT NOT NULL,
    "keyResponsibilities" TEXT NOT NULL,
    "kpis" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "offer_letters_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "offer_letters_employeeId_key" ON "offer_letters"("employeeId");
CREATE UNIQUE INDEX "offer_letters_referenceNumber_key" ON "offer_letters"("referenceNumber");
CREATE INDEX "offer_letters_createdById_idx" ON "offer_letters"("createdById");

ALTER TABLE "offer_letters" ADD CONSTRAINT "offer_letters_employeeId_fkey"
FOREIGN KEY ("employeeId") REFERENCES "employees"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "offer_letters" ADD CONSTRAINT "offer_letters_createdById_fkey"
FOREIGN KEY ("createdById") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
