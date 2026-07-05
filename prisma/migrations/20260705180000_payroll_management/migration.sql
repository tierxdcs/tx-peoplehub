-- CreateEnum
CREATE TYPE "StatutoryConfigType" AS ENUM ('PF', 'ESI', 'PROFESSIONAL_TAX', 'TDS_SLAB', 'STANDARD_DEDUCTION');

-- CreateEnum
CREATE TYPE "PayrollRunStatus" AS ENUM ('DRAFT', 'PROCESSING', 'COMPLETED', 'LOCKED');

-- CreateEnum
CREATE TYPE "PayslipStatus" AS ENUM ('GENERATED', 'PAID');

-- CreateTable
CREATE TABLE "salary_structures" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "effectiveFrom" TIMESTAMP(3) NOT NULL,
    "basic" DECIMAL(14,2) NOT NULL,
    "hra" DECIMAL(14,2) NOT NULL,
    "specialAllowance" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "otherAllowances" DECIMAL(14,2),
    "ctcAnnual" DECIMAL(14,2) NOT NULL,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "salary_structures_pkey" PRIMARY KEY ("id")
);

-- DataMigration: carry every existing employee_compensation row over into
-- salary_structures before dropping the old table, so no salary data is
-- silently lost. specialAllowance defaults to 0 and ctcAnnual is computed
-- as (basic + hra) * 12 — a documented placeholder consistent with how
-- EmployeesService.onboard() will now populate new rows (see
-- payroll module's SalaryStructuresService).
INSERT INTO "salary_structures" (
    "id", "employeeId", "effectiveFrom", "basic", "hra",
    "specialAllowance", "otherAllowances", "ctcAnnual",
    "createdById", "createdAt", "updatedAt"
)
SELECT
    "id", "employeeId", "effectiveDate", "basicSalary", "hra",
    0, NULL, ("basicSalary" + "hra") * 12,
    "createdById", "createdAt", "updatedAt"
FROM "employee_compensation";

-- DropForeignKey
ALTER TABLE "employee_compensation" DROP CONSTRAINT "employee_compensation_createdById_fkey";

-- DropForeignKey
ALTER TABLE "employee_compensation" DROP CONSTRAINT "employee_compensation_employeeId_fkey";

-- DropTable
DROP TABLE "employee_compensation";

-- CreateTable
CREATE TABLE "statutory_configs" (
    "id" TEXT NOT NULL,
    "configType" "StatutoryConfigType" NOT NULL,
    "state" TEXT,
    "effectiveFrom" TIMESTAMP(3) NOT NULL,
    "effectiveTo" TIMESTAMP(3),
    "configData" JSONB NOT NULL,
    "sourceNote" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "statutory_configs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payroll_runs" (
    "id" TEXT NOT NULL,
    "month" INTEGER NOT NULL,
    "year" INTEGER NOT NULL,
    "status" "PayrollRunStatus" NOT NULL DEFAULT 'DRAFT',
    "initiatedById" TEXT NOT NULL,
    "processedAt" TIMESTAMP(3),
    "lockedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payroll_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payslips" (
    "id" TEXT NOT NULL,
    "payrollRunId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "grossEarnings" DECIMAL(14,2) NOT NULL,
    "basicPaid" DECIMAL(14,2) NOT NULL,
    "hraPaid" DECIMAL(14,2) NOT NULL,
    "specialAllowancePaid" DECIMAL(14,2) NOT NULL,
    "otherAllowancesPaid" DECIMAL(14,2) NOT NULL,
    "pfEmployee" DECIMAL(14,2) NOT NULL,
    "pfEmployer" DECIMAL(14,2) NOT NULL,
    "esiEmployee" DECIMAL(14,2),
    "esiEmployer" DECIMAL(14,2),
    "professionalTax" DECIMAL(14,2),
    "tdsDeducted" DECIMAL(14,2) NOT NULL,
    "unpaidLeaveDeduction" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "netPay" DECIMAL(14,2) NOT NULL,
    "statutoryConfigSnapshot" JSONB NOT NULL,
    "status" "PayslipStatus" NOT NULL DEFAULT 'GENERATED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payslips_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "salary_structures_employeeId_effectiveFrom_idx" ON "salary_structures"("employeeId", "effectiveFrom");

-- CreateIndex
CREATE INDEX "statutory_configs_configType_state_effectiveFrom_idx" ON "statutory_configs"("configType", "state", "effectiveFrom");

-- CreateIndex
CREATE UNIQUE INDEX "payroll_runs_month_year_key" ON "payroll_runs"("month", "year");

-- CreateIndex
CREATE UNIQUE INDEX "payslips_payrollRunId_employeeId_key" ON "payslips"("payrollRunId", "employeeId");

-- AddForeignKey
ALTER TABLE "salary_structures" ADD CONSTRAINT "salary_structures_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "employees"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "salary_structures" ADD CONSTRAINT "salary_structures_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "employees"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payroll_runs" ADD CONSTRAINT "payroll_runs_initiatedById_fkey" FOREIGN KEY ("initiatedById") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payslips" ADD CONSTRAINT "payslips_payrollRunId_fkey" FOREIGN KEY ("payrollRunId") REFERENCES "payroll_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payslips" ADD CONSTRAINT "payslips_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

