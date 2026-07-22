-- CreateEnum
CREATE TYPE "ContraVoucherStatus" AS ENUM ('DRAFT', 'PENDING_APPROVAL', 'REJECTED', 'POSTED', 'REVERSED');

-- CreateTable
CREATE TABLE "contra_vouchers" (
    "id" TEXT NOT NULL,
    "voucherNumber" TEXT NOT NULL,
    "voucherDate" TIMESTAMP(3) NOT NULL,
    "fromLedgerAccountId" TEXT NOT NULL,
    "toLedgerAccountId" TEXT NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "narration" TEXT,
    "status" "ContraVoucherStatus" NOT NULL DEFAULT 'DRAFT',
    "createdById" TEXT NOT NULL,
    "submittedById" TEXT,
    "submittedAt" TIMESTAMP(3),
    "approvedById" TEXT,
    "approvedAt" TIMESTAMP(3),
    "rejectionComment" TEXT,
    "journalEntryId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "contra_vouchers_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "contra_vouchers_voucherNumber_key" ON "contra_vouchers"("voucherNumber");

-- CreateIndex
CREATE UNIQUE INDEX "contra_vouchers_journalEntryId_key" ON "contra_vouchers"("journalEntryId");

-- CreateIndex
CREATE INDEX "contra_vouchers_voucherDate_idx" ON "contra_vouchers"("voucherDate");

-- AddForeignKey
ALTER TABLE "contra_vouchers" ADD CONSTRAINT "contra_vouchers_fromLedgerAccountId_fkey" FOREIGN KEY ("fromLedgerAccountId") REFERENCES "ledger_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contra_vouchers" ADD CONSTRAINT "contra_vouchers_toLedgerAccountId_fkey" FOREIGN KEY ("toLedgerAccountId") REFERENCES "ledger_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contra_vouchers" ADD CONSTRAINT "contra_vouchers_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contra_vouchers" ADD CONSTRAINT "contra_vouchers_submittedById_fkey" FOREIGN KEY ("submittedById") REFERENCES "employees"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contra_vouchers" ADD CONSTRAINT "contra_vouchers_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "employees"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contra_vouchers" ADD CONSTRAINT "contra_vouchers_journalEntryId_fkey" FOREIGN KEY ("journalEntryId") REFERENCES "journal_entries"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
