CREATE TYPE "PingRecipientStatus" AS ENUM ('PENDING', 'ACKNOWLEDGED', 'RESOLVED');

CREATE TABLE "pings" (
  "id" TEXT NOT NULL,
  "fromEmployeeId" TEXT NOT NULL,
  "message" VARCHAR(500) NOT NULL,
  "linkedRecordType" VARCHAR(60),
  "linkedRecordId" VARCHAR(120),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "pings_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ping_recipients" (
  "id" TEXT NOT NULL,
  "pingId" TEXT NOT NULL,
  "employeeId" TEXT NOT NULL,
  "status" "PingRecipientStatus" NOT NULL DEFAULT 'PENDING',
  "respondedAt" TIMESTAMP(3),
  CONSTRAINT "ping_recipients_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "pings_fromEmployeeId_createdAt_idx" ON "pings"("fromEmployeeId", "createdAt");
CREATE UNIQUE INDEX "ping_recipients_pingId_employeeId_key" ON "ping_recipients"("pingId", "employeeId");
CREATE INDEX "ping_recipients_employeeId_status_idx" ON "ping_recipients"("employeeId", "status");
ALTER TABLE "pings" ADD CONSTRAINT "pings_fromEmployeeId_fkey" FOREIGN KEY ("fromEmployeeId") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ping_recipients" ADD CONSTRAINT "ping_recipients_pingId_fkey" FOREIGN KEY ("pingId") REFERENCES "pings"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ping_recipients" ADD CONSTRAINT "ping_recipients_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "employees"("id") ON DELETE CASCADE ON UPDATE CASCADE;
