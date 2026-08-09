CREATE TYPE "ProvisioningApproverType" AS ENUM ('SUPER_ADMIN', 'VERTICAL_OWNER');
CREATE TYPE "ProvisioningRequestStatus" AS ENUM ('PENDING_APPROVAL', 'REJECTED', 'APPROVED', 'SENT_TO_SCM', 'FULFILLED', 'COMPLETED');

CREATE TABLE "provisioning_item_types" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "requiresScmFulfillment" BOOLEAN NOT NULL DEFAULT true,
  "approverType" "ProvisioningApproverType" NOT NULL,
  "approverVerticalId" TEXT,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "provisioning_item_types_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "provisioning_requests" (
  "id" TEXT NOT NULL,
  "employeeId" TEXT NOT NULL,
  "itemTypeId" TEXT NOT NULL,
  "status" "ProvisioningRequestStatus" NOT NULL DEFAULT 'PENDING_APPROVAL',
  "approvedById" TEXT,
  "approvedAt" TIMESTAMP(3),
  "rejectionComment" TEXT,
  "fulfilledById" TEXT,
  "fulfilledAt" TIMESTAMP(3),
  "completedById" TEXT,
  "completedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "provisioning_requests_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "provisioning_item_types_name_key" ON "provisioning_item_types"("name");
CREATE INDEX "provisioning_item_types_isActive_idx" ON "provisioning_item_types"("isActive");
CREATE INDEX "provisioning_item_types_approverVerticalId_idx" ON "provisioning_item_types"("approverVerticalId");
CREATE UNIQUE INDEX "provisioning_requests_employeeId_itemTypeId_key" ON "provisioning_requests"("employeeId", "itemTypeId");
CREATE INDEX "provisioning_requests_status_idx" ON "provisioning_requests"("status");
CREATE INDEX "provisioning_requests_itemTypeId_idx" ON "provisioning_requests"("itemTypeId");

ALTER TABLE "provisioning_item_types" ADD CONSTRAINT "provisioning_item_types_approverVerticalId_fkey" FOREIGN KEY ("approverVerticalId") REFERENCES "verticals"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "provisioning_requests" ADD CONSTRAINT "provisioning_requests_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "employees"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "provisioning_requests" ADD CONSTRAINT "provisioning_requests_itemTypeId_fkey" FOREIGN KEY ("itemTypeId") REFERENCES "provisioning_item_types"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "provisioning_requests" ADD CONSTRAINT "provisioning_requests_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "employees"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "provisioning_requests" ADD CONSTRAINT "provisioning_requests_fulfilledById_fkey" FOREIGN KEY ("fulfilledById") REFERENCES "employees"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "provisioning_requests" ADD CONSTRAINT "provisioning_requests_completedById_fkey" FOREIGN KEY ("completedById") REFERENCES "employees"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Production-safe baseline configuration. The application seed repeats these
-- as idempotent upserts for local/test resets; this insert ensures deploys that
-- run migrations (but not `prisma db seed`) receive the confirmed defaults.
INSERT INTO "provisioning_item_types" ("id", "name", "requiresScmFulfillment", "approverType", "approverVerticalId", "isActive", "createdAt", "updatedAt")
VALUES
  (gen_random_uuid()::text, 'Laptop', true, 'SUPER_ADMIN', NULL, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'Email ID Creation', false, 'SUPER_ADMIN', NULL, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("name") DO NOTHING;

INSERT INTO "provisioning_item_types" ("id", "name", "requiresScmFulfillment", "approverType", "approverVerticalId", "isActive", "createdAt", "updatedAt")
SELECT gen_random_uuid()::text, item."name", true, 'VERTICAL_OWNER'::"ProvisioningApproverType", v."id", true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "verticals" v
CROSS JOIN (VALUES ('ID Card'), ('Business Card'), ('Joining Kit')) AS item("name")
WHERE v."code" = 'HR'
ON CONFLICT ("name") DO NOTHING;
