CREATE TYPE "BidStrategyActionStatus" AS ENUM ('OPEN', 'DONE');

CREATE TABLE "bid_strategy_meetings" (
  "id" TEXT NOT NULL,
  "bidId" TEXT NOT NULL,
  "meetingDate" TIMESTAMP(3) NOT NULL,
  "meetingMode" "KickoffMeetingMode" NOT NULL DEFAULT 'VIRTUAL',
  "meetingLink" TEXT,
  "notes" TEXT NOT NULL,
  "createdById" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "bid_strategy_meetings_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "bid_strategy_meeting_attendees" (
  "id" TEXT NOT NULL,
  "meetingId" TEXT NOT NULL,
  "employeeId" TEXT,
  "externalName" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "bid_strategy_meeting_attendees_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "bid_strategy_attendee_exactly_one_check" CHECK (("employeeId" IS NOT NULL) <> ("externalName" IS NOT NULL))
);

CREATE TABLE "bid_strategy_action_items" (
  "id" TEXT NOT NULL,
  "meetingId" TEXT NOT NULL,
  "description" TEXT NOT NULL,
  "ownerId" TEXT NOT NULL,
  "dueDate" TIMESTAMP(3),
  "status" "BidStrategyActionStatus" NOT NULL DEFAULT 'OPEN',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "bid_strategy_action_items_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "bid_strategy_meetings_bidId_meetingDate_idx" ON "bid_strategy_meetings"("bidId", "meetingDate");
CREATE INDEX "bid_strategy_meeting_attendees_meetingId_idx" ON "bid_strategy_meeting_attendees"("meetingId");
CREATE INDEX "bid_strategy_meeting_attendees_employeeId_idx" ON "bid_strategy_meeting_attendees"("employeeId");
CREATE INDEX "bid_strategy_action_items_meetingId_idx" ON "bid_strategy_action_items"("meetingId");
CREATE INDEX "bid_strategy_action_items_ownerId_idx" ON "bid_strategy_action_items"("ownerId");

ALTER TABLE "bid_strategy_meetings" ADD CONSTRAINT "bid_strategy_meetings_bidId_fkey" FOREIGN KEY ("bidId") REFERENCES "bids"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "bid_strategy_meetings" ADD CONSTRAINT "bid_strategy_meetings_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "bid_strategy_meeting_attendees" ADD CONSTRAINT "bid_strategy_meeting_attendees_meetingId_fkey" FOREIGN KEY ("meetingId") REFERENCES "bid_strategy_meetings"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "bid_strategy_meeting_attendees" ADD CONSTRAINT "bid_strategy_meeting_attendees_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "employees"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "bid_strategy_action_items" ADD CONSTRAINT "bid_strategy_action_items_meetingId_fkey" FOREIGN KEY ("meetingId") REFERENCES "bid_strategy_meetings"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "bid_strategy_action_items" ADD CONSTRAINT "bid_strategy_action_items_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
