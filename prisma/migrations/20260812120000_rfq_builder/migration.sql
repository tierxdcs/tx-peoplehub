-- RFQ Builder (SCM). Additive. Rfq + lines + invitees + quotes + quote lines.
-- Sealed-bid + award-override rules are enforced at the service layer. Exactly
-- one of supplier/vendor on an invitee is enforced by a CHECK constraint (like
-- purchase_orders).

CREATE TYPE "RfqStatus" AS ENUM ('DRAFT', 'ISSUED', 'CLOSED', 'AWARDED', 'CANCELLED');
CREATE TYPE "RfqQuoteStatus" AS ENUM ('INVITED', 'VIEWED', 'SUBMITTED', 'DECLINED');

CREATE TABLE "rfqs" (
  "id" TEXT NOT NULL,
  "rfqNumber" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "description" TEXT,
  "status" "RfqStatus" NOT NULL DEFAULT 'DRAFT',
  "projectKickoffId" TEXT,
  "submissionDeadline" TIMESTAMP(3) NOT NULL,
  "requiredByDate" TIMESTAMP(3),
  "deliveryLocation" TEXT,
  "paymentTermsRequested" TEXT,
  "awardedInviteeId" TEXT,
  "awardDecisionById" TEXT,
  "awardDecisionAt" TIMESTAMP(3),
  "awardJustification" TEXT,
  "createdById" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "rfqs_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "rfqs_rfqNumber_key" ON "rfqs"("rfqNumber");
CREATE UNIQUE INDEX "rfqs_awardedInviteeId_key" ON "rfqs"("awardedInviteeId");
CREATE INDEX "rfqs_status_idx" ON "rfqs"("status");
CREATE INDEX "rfqs_projectKickoffId_idx" ON "rfqs"("projectKickoffId");

CREATE TABLE "rfq_lines" (
  "id" TEXT NOT NULL,
  "rfqId" TEXT NOT NULL,
  "itemId" TEXT NOT NULL,
  "quantity" DECIMAL(14,4) NOT NULL,
  "unitOfMeasure" TEXT NOT NULL,
  "specificationNotes" TEXT,
  "sequence" INTEGER NOT NULL DEFAULT 0,
  CONSTRAINT "rfq_lines_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "rfq_lines_rfqId_idx" ON "rfq_lines"("rfqId");
CREATE INDEX "rfq_lines_itemId_idx" ON "rfq_lines"("itemId");

CREATE TABLE "rfq_invitees" (
  "id" TEXT NOT NULL,
  "rfqId" TEXT NOT NULL,
  "supplierId" TEXT,
  "vendorId" TEXT,
  "inviteToken" TEXT NOT NULL,
  "tokenExpiresAt" TIMESTAMP(3) NOT NULL,
  "passwordHash" TEXT,
  "revokedAt" TIMESTAMP(3),
  "qualificationStatusSnapshot" TEXT NOT NULL,
  "quoteStatus" "RfqQuoteStatus" NOT NULL DEFAULT 'INVITED',
  "submittedAt" TIMESTAMP(3),
  "declineReason" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "rfq_invitees_pkey" PRIMARY KEY ("id"),
  -- Exactly one trading partner: precisely one of supplierId / vendorId is set.
  CONSTRAINT "rfq_invitees_exactly_one_partner"
    CHECK (("supplierId" IS NOT NULL)::int + ("vendorId" IS NOT NULL)::int = 1)
);
CREATE UNIQUE INDEX "rfq_invitees_inviteToken_key" ON "rfq_invitees"("inviteToken");
CREATE INDEX "rfq_invitees_rfqId_idx" ON "rfq_invitees"("rfqId");
CREATE INDEX "rfq_invitees_supplierId_idx" ON "rfq_invitees"("supplierId");
CREATE INDEX "rfq_invitees_vendorId_idx" ON "rfq_invitees"("vendorId");

CREATE TABLE "rfq_quotes" (
  "id" TEXT NOT NULL,
  "inviteeId" TEXT NOT NULL,
  "quotedLeadTimeDays" INTEGER,
  "paymentTermsOffered" TEXT,
  "validityDays" INTEGER,
  "notes" TEXT,
  "attachmentFileKeys" JSONB,
  "totalQuotedValue" DECIMAL(18,2) NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "rfq_quotes_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "rfq_quotes_inviteeId_key" ON "rfq_quotes"("inviteeId");

CREATE TABLE "rfq_quote_lines" (
  "id" TEXT NOT NULL,
  "quoteId" TEXT NOT NULL,
  "rfqLineId" TEXT NOT NULL,
  "unitPrice" DECIMAL(18,2) NOT NULL,
  "lineTotal" DECIMAL(18,2) NOT NULL,
  "deliveryLeadTimeDays" INTEGER,
  "remarks" TEXT,
  CONSTRAINT "rfq_quote_lines_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "rfq_quote_lines_quoteId_rfqLineId_key" ON "rfq_quote_lines"("quoteId", "rfqLineId");
CREATE INDEX "rfq_quote_lines_rfqLineId_idx" ON "rfq_quote_lines"("rfqLineId");

ALTER TABLE "rfqs" ADD CONSTRAINT "rfqs_projectKickoffId_fkey"
  FOREIGN KEY ("projectKickoffId") REFERENCES "project_kickoffs"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "rfqs" ADD CONSTRAINT "rfqs_awardedInviteeId_fkey"
  FOREIGN KEY ("awardedInviteeId") REFERENCES "rfq_invitees"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "rfqs" ADD CONSTRAINT "rfqs_awardDecisionById_fkey"
  FOREIGN KEY ("awardDecisionById") REFERENCES "employees"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "rfqs" ADD CONSTRAINT "rfqs_createdById_fkey"
  FOREIGN KEY ("createdById") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "rfq_lines" ADD CONSTRAINT "rfq_lines_rfqId_fkey"
  FOREIGN KEY ("rfqId") REFERENCES "rfqs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "rfq_lines" ADD CONSTRAINT "rfq_lines_itemId_fkey"
  FOREIGN KEY ("itemId") REFERENCES "items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "rfq_invitees" ADD CONSTRAINT "rfq_invitees_rfqId_fkey"
  FOREIGN KEY ("rfqId") REFERENCES "rfqs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "rfq_invitees" ADD CONSTRAINT "rfq_invitees_supplierId_fkey"
  FOREIGN KEY ("supplierId") REFERENCES "suppliers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "rfq_invitees" ADD CONSTRAINT "rfq_invitees_vendorId_fkey"
  FOREIGN KEY ("vendorId") REFERENCES "vendors"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "rfq_quotes" ADD CONSTRAINT "rfq_quotes_inviteeId_fkey"
  FOREIGN KEY ("inviteeId") REFERENCES "rfq_invitees"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "rfq_quote_lines" ADD CONSTRAINT "rfq_quote_lines_quoteId_fkey"
  FOREIGN KEY ("quoteId") REFERENCES "rfq_quotes"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "rfq_quote_lines" ADD CONSTRAINT "rfq_quote_lines_rfqLineId_fkey"
  FOREIGN KEY ("rfqLineId") REFERENCES "rfq_lines"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
