CREATE TABLE "bid_amc_charges" (
    "id" TEXT NOT NULL,
    "bidId" TEXT NOT NULL,
    "yearNumber" INTEGER NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "bid_amc_charges_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "bid_amc_charges_year_check"
        CHECK ("yearNumber" IN (2, 3, 4, 5)),
    CONSTRAINT "bid_amc_charges_amount_check"
        CHECK ("amount" >= 0)
);

CREATE UNIQUE INDEX "bid_amc_charges_bidId_yearNumber_key"
    ON "bid_amc_charges"("bidId", "yearNumber");

CREATE INDEX "bid_amc_charges_bidId_idx"
    ON "bid_amc_charges"("bidId");

ALTER TABLE "bid_amc_charges"
    ADD CONSTRAINT "bid_amc_charges_bidId_fkey"
    FOREIGN KEY ("bidId") REFERENCES "bids"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
