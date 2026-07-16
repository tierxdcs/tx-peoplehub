-- Techno Commercial Proposal: one-line quotation subject on the bid.
-- Optional; existing bids read as NULL (Subject line falls back gracefully).
ALTER TABLE "bids" ADD COLUMN "quotationSubject" TEXT;
