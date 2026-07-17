-- Project Kickoff module: PM designation + kickoff records with Kanban-linked action items.

-- Employee: Project Manager designation
ALTER TABLE "employees" ADD COLUMN "isProjectManager" BOOLEAN NOT NULL DEFAULT false;

-- Enums
CREATE TYPE "KickoffMeetingMode" AS ENUM ('IN_PERSON', 'VIRTUAL', 'HYBRID');
CREATE TYPE "KickoffStatus" AS ENUM ('DRAFT', 'COMPLETED');
CREATE TYPE "KickoffMilestoneStatus" AS ENUM ('PENDING', 'IN_PROGRESS', 'COMPLETED', 'DELAYED');
CREATE TYPE "KickoffRiskLevel" AS ENUM ('LOW', 'MEDIUM', 'HIGH');
CREATE TYPE "KickoffRiskStatus" AS ENUM ('OPEN', 'MITIGATED', 'CLOSED');

-- ProjectKickoff
CREATE TABLE "project_kickoffs" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "projectName" TEXT NOT NULL,
    "meetingDate" TIMESTAMP(3) NOT NULL,
    "meetingMode" "KickoffMeetingMode" NOT NULL DEFAULT 'VIRTUAL',
    "meetingLocation" TEXT,
    "overviewAndScope" TEXT,
    "minutesNotes" TEXT,
    "status" "KickoffStatus" NOT NULL DEFAULT 'DRAFT',
    "kanbanBoardId" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "project_kickoffs_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "project_kickoffs_orderId_idx" ON "project_kickoffs"("orderId");
CREATE INDEX "project_kickoffs_createdById_idx" ON "project_kickoffs"("createdById");

-- KickoffAttendee
CREATE TABLE "kickoff_attendees" (
    "id" TEXT NOT NULL,
    "kickoffId" TEXT NOT NULL,
    "employeeId" TEXT,
    "externalName" TEXT,
    "externalOrganization" TEXT,
    "designation" TEXT,
    "department" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "kickoff_attendees_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "kickoff_attendees_kickoffId_idx" ON "kickoff_attendees"("kickoffId");

-- KickoffMilestone
CREATE TABLE "kickoff_milestones" (
    "id" TEXT NOT NULL,
    "kickoffId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "targetDate" TIMESTAMP(3) NOT NULL,
    "ownerId" TEXT,
    "status" "KickoffMilestoneStatus" NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "kickoff_milestones_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "kickoff_milestones_kickoffId_idx" ON "kickoff_milestones"("kickoffId");

-- KickoffActionItem
CREATE TABLE "kickoff_action_items" (
    "id" TEXT NOT NULL,
    "kickoffId" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "dueDate" TIMESTAMP(3),
    "kanbanCardId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "kickoff_action_items_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "kickoff_action_items_kanbanCardId_key" ON "kickoff_action_items"("kanbanCardId");
CREATE INDEX "kickoff_action_items_kickoffId_idx" ON "kickoff_action_items"("kickoffId");

-- KickoffRisk
CREATE TABLE "kickoff_risks" (
    "id" TEXT NOT NULL,
    "kickoffId" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "likelihood" "KickoffRiskLevel" NOT NULL DEFAULT 'MEDIUM',
    "impact" "KickoffRiskLevel" NOT NULL DEFAULT 'MEDIUM',
    "mitigationPlan" TEXT,
    "ownerId" TEXT,
    "status" "KickoffRiskStatus" NOT NULL DEFAULT 'OPEN',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "kickoff_risks_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "kickoff_risks_kickoffId_idx" ON "kickoff_risks"("kickoffId");

-- FKs
ALTER TABLE "project_kickoffs" ADD CONSTRAINT "project_kickoffs_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "project_kickoffs" ADD CONSTRAINT "project_kickoffs_kanbanBoardId_fkey" FOREIGN KEY ("kanbanBoardId") REFERENCES "kanban_boards"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "project_kickoffs" ADD CONSTRAINT "project_kickoffs_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "kickoff_attendees" ADD CONSTRAINT "kickoff_attendees_kickoffId_fkey" FOREIGN KEY ("kickoffId") REFERENCES "project_kickoffs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "kickoff_attendees" ADD CONSTRAINT "kickoff_attendees_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "employees"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "kickoff_milestones" ADD CONSTRAINT "kickoff_milestones_kickoffId_fkey" FOREIGN KEY ("kickoffId") REFERENCES "project_kickoffs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "kickoff_milestones" ADD CONSTRAINT "kickoff_milestones_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "employees"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "kickoff_action_items" ADD CONSTRAINT "kickoff_action_items_kickoffId_fkey" FOREIGN KEY ("kickoffId") REFERENCES "project_kickoffs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "kickoff_action_items" ADD CONSTRAINT "kickoff_action_items_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "kickoff_action_items" ADD CONSTRAINT "kickoff_action_items_kanbanCardId_fkey" FOREIGN KEY ("kanbanCardId") REFERENCES "kanban_cards"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "kickoff_risks" ADD CONSTRAINT "kickoff_risks_kickoffId_fkey" FOREIGN KEY ("kickoffId") REFERENCES "project_kickoffs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "kickoff_risks" ADD CONSTRAINT "kickoff_risks_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "employees"("id") ON DELETE SET NULL ON UPDATE CASCADE;
