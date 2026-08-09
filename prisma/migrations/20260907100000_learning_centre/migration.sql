CREATE TYPE "LearningCourseStatus" AS ENUM ('DRAFT', 'PUBLISHED');

CREATE TABLE "learning_courses" (
  "id" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "summary" TEXT NOT NULL,
  "verticalId" TEXT NOT NULL,
  "status" "LearningCourseStatus" NOT NULL DEFAULT 'DRAFT',
  "version" INTEGER NOT NULL DEFAULT 1,
  "content" JSONB NOT NULL,
  "createdById" TEXT NOT NULL,
  "updatedById" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "learning_courses_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "learning_progress" (
  "id" TEXT NOT NULL,
  "courseId" TEXT NOT NULL,
  "employeeId" TEXT NOT NULL,
  "courseVersion" INTEGER NOT NULL DEFAULT 1,
  "completedLessonKeys" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "scorePercent" DECIMAL(5,2),
  "completedAt" TIMESTAMP(3),
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "learning_progress_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "learning_courses_verticalId_status_idx" ON "learning_courses"("verticalId", "status");
CREATE UNIQUE INDEX "learning_progress_courseId_employeeId_key" ON "learning_progress"("courseId", "employeeId");
CREATE INDEX "learning_progress_employeeId_completedAt_idx" ON "learning_progress"("employeeId", "completedAt");
ALTER TABLE "learning_courses" ADD CONSTRAINT "learning_courses_verticalId_fkey" FOREIGN KEY ("verticalId") REFERENCES "verticals"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "learning_courses" ADD CONSTRAINT "learning_courses_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "learning_courses" ADD CONSTRAINT "learning_courses_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "learning_progress" ADD CONSTRAINT "learning_progress_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "learning_courses"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "learning_progress" ADD CONSTRAINT "learning_progress_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "employees"("id") ON DELETE CASCADE ON UPDATE CASCADE;
