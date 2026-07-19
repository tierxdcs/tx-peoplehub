CREATE TYPE "QmsEquipmentStatus" AS ENUM ('ACTIVE', 'DUE', 'OVERDUE', 'OUT_OF_SERVICE', 'RETIRED');
CREATE TYPE "QmsCalibrationResult" AS ENUM ('PASS', 'FAIL', 'LIMITED_USE');
CREATE TYPE "QmsCalibrationReviewStatus" AS ENUM ('PENDING_REVIEW', 'ACCEPTED', 'REJECTED');
CREATE TYPE "QmsComplaintStatus" AS ENUM ('OPEN', 'INVESTIGATION', 'PENDING_CLOSURE', 'CLOSED', 'CANCELLED');

CREATE TABLE "qms_measuring_equipment" (
  "id" TEXT NOT NULL, "equipmentCode" TEXT NOT NULL, "name" TEXT NOT NULL,
  "serialNumber" TEXT, "manufacturer" TEXT, "model" TEXT, "measurementRange" TEXT,
  "leastCount" TEXT, "location" TEXT, "custodianId" TEXT NOT NULL,
  "calibrationFrequencyDays" INTEGER NOT NULL, "lastCalibrationDate" TIMESTAMP(3),
  "nextCalibrationDate" TIMESTAMP(3) NOT NULL, "status" "QmsEquipmentStatus" NOT NULL DEFAULT 'ACTIVE',
  "notes" TEXT, "createdById" TEXT NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL, CONSTRAINT "qms_measuring_equipment_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "qms_measuring_equipment_equipmentCode_key" ON "qms_measuring_equipment"("equipmentCode");
CREATE UNIQUE INDEX "qms_measuring_equipment_serialNumber_key" ON "qms_measuring_equipment"("serialNumber");
CREATE INDEX "qms_measuring_equipment_status_nextCalibrationDate_idx" ON "qms_measuring_equipment"("status", "nextCalibrationDate");
CREATE INDEX "qms_measuring_equipment_custodianId_idx" ON "qms_measuring_equipment"("custodianId");

CREATE TABLE "qms_calibration_records" (
  "id" TEXT NOT NULL, "calibrationNumber" TEXT NOT NULL, "equipmentId" TEXT NOT NULL,
  "calibrationDate" TIMESTAMP(3) NOT NULL, "nextDueDate" TIMESTAMP(3) NOT NULL,
  "result" "QmsCalibrationResult" NOT NULL,
  "reviewStatus" "QmsCalibrationReviewStatus" NOT NULL DEFAULT 'PENDING_REVIEW',
  "agency" TEXT, "certificateNumber" TEXT, "certificateEvidence" JSONB, "observedResults" JSONB,
  "remarks" TEXT, "performedById" TEXT NOT NULL, "reviewedById" TEXT, "reviewedAt" TIMESTAMP(3),
  "ncrId" TEXT, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "qms_calibration_records_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "qms_calibration_records_calibrationNumber_key" ON "qms_calibration_records"("calibrationNumber");
CREATE UNIQUE INDEX "qms_calibration_records_ncrId_key" ON "qms_calibration_records"("ncrId");
CREATE INDEX "qms_calibration_records_equipmentId_calibrationDate_idx" ON "qms_calibration_records"("equipmentId", "calibrationDate");
CREATE INDEX "qms_calibration_records_reviewStatus_idx" ON "qms_calibration_records"("reviewStatus");
ALTER TABLE "qms_calibration_records" ADD CONSTRAINT "qms_calibration_records_equipmentId_fkey" FOREIGN KEY ("equipmentId") REFERENCES "qms_measuring_equipment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "qms_customer_complaints" (
  "id" TEXT NOT NULL, "complaintNumber" TEXT NOT NULL, "customerId" TEXT NOT NULL,
  "orderId" TEXT, "productId" TEXT, "status" "QmsComplaintStatus" NOT NULL DEFAULT 'OPEN',
  "severity" "QmsNcrSeverity" NOT NULL, "reportedAt" TIMESTAMP(3) NOT NULL, "reportedBy" TEXT,
  "title" TEXT NOT NULL, "description" TEXT NOT NULL, "ownerId" TEXT NOT NULL,
  "targetDate" TIMESTAMP(3) NOT NULL, "immediateAction" TEXT, "investigation" TEXT,
  "responseToCustomer" TEXT, "ncrId" TEXT, "createdById" TEXT NOT NULL, "closedById" TEXT,
  "closedAt" TIMESTAMP(3), "closureNote" TEXT, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL, CONSTRAINT "qms_customer_complaints_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "qms_customer_complaints_complaintNumber_key" ON "qms_customer_complaints"("complaintNumber");
CREATE UNIQUE INDEX "qms_customer_complaints_ncrId_key" ON "qms_customer_complaints"("ncrId");
CREATE INDEX "qms_customer_complaints_status_targetDate_idx" ON "qms_customer_complaints"("status", "targetDate");
CREATE INDEX "qms_customer_complaints_customerId_reportedAt_idx" ON "qms_customer_complaints"("customerId", "reportedAt");
CREATE INDEX "qms_customer_complaints_severity_status_idx" ON "qms_customer_complaints"("severity", "status");
