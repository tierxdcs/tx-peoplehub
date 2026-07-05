-- CreateEnum
CREATE TYPE "AccessStatus" AS ENUM ('PENDING_ACCESS', 'ACTIVE', 'INACTIVE');

-- CreateEnum
CREATE TYPE "EmploymentType" AS ENUM ('FULL_TIME_PERMANENT', 'CONTRACT', 'INTERN', 'PART_TIME');

-- AlterTable
ALTER TABLE "employees" ADD COLUMN     "accessStatus" "AccessStatus" NOT NULL DEFAULT 'PENDING_ACCESS',
ADD COLUMN     "dateOfBirth" TIMESTAMP(3),
ADD COLUMN     "dateOfJoining" TIMESTAMP(3),
ADD COLUMN     "designation" TEXT,
ADD COLUMN     "emergencyContactName" TEXT,
ADD COLUMN     "emergencyContactPhone" TEXT,
ADD COLUMN     "emergencyContactRelation" TEXT,
ADD COLUMN     "employmentType" "EmploymentType",
ADD COLUMN     "gender" TEXT,
ADD COLUMN     "mobile" TEXT,
ADD COLUMN     "officialEmail" TEXT,
ADD COLUMN     "personalEmail" TEXT,
ADD COLUMN     "workLocation" TEXT,
ALTER COLUMN "passwordHash" DROP NOT NULL,
ALTER COLUMN "role" DROP NOT NULL;

-- CreateTable
CREATE TABLE "employee_compensation" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "basicSalary" DECIMAL(14,2) NOT NULL,
    "hra" DECIMAL(14,2) NOT NULL,
    "effectiveDate" TIMESTAMP(3) NOT NULL,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "employee_compensation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "employee_statutory_info" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "panNumber" TEXT NOT NULL,
    "aadhaarLast4" TEXT NOT NULL,
    "pfAccountNumber" TEXT NOT NULL,
    "esicNumber" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "employee_statutory_info_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "employee_bank_details" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "bankAccountNumber" TEXT NOT NULL,
    "ifscCode" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "employee_bank_details_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "employee_compensation_employeeId_key" ON "employee_compensation"("employeeId");

-- CreateIndex
CREATE UNIQUE INDEX "employee_statutory_info_employeeId_key" ON "employee_statutory_info"("employeeId");

-- CreateIndex
CREATE UNIQUE INDEX "employee_bank_details_employeeId_key" ON "employee_bank_details"("employeeId");

-- CreateIndex
CREATE UNIQUE INDEX "employees_officialEmail_key" ON "employees"("officialEmail");

-- CreateIndex
CREATE INDEX "employees_accessStatus_idx" ON "employees"("accessStatus");

-- AddForeignKey
ALTER TABLE "employee_compensation" ADD CONSTRAINT "employee_compensation_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "employees"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee_compensation" ADD CONSTRAINT "employee_compensation_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "employees"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee_statutory_info" ADD CONSTRAINT "employee_statutory_info_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "employees"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee_bank_details" ADD CONSTRAINT "employee_bank_details_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "employees"("id") ON DELETE CASCADE ON UPDATE CASCADE;

