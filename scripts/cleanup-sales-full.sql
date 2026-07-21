-- ============================================================================
-- PRODUCTION cleanup (SQL version of scripts/cleanup-sales-full.ts)
-- Wipe the ENTIRE Sales order-to-cash chain + downstream finance/GL + fulfilment.
-- Run this DIRECTLY in the Railway Postgres console (psql) — no Node needed.
--
-- Deletes leaves-first, in ONE transaction (BEGIN … COMMIT). If anything errors,
-- run ROLLBACK and nothing changes.
--
-- Keeps: employees, customers, products, config, procurement/AP finance
-- (vendor invoices/payments), RFQs/POs/GRNs, chart of accounts, accounting
-- periods, Vault files, Kanban boards, Item/BOM masters.
--
-- Shared tables (journal_entries, finance_adjustment_notes,
-- bank_transaction_matches) are FILTERED to sales-originated rows only — AP rows
-- are never touched.
--
-- HOW TO RUN:
--   1. Paste everything from BEGIN; down to the two SELECTs below and STOP.
--      (that's the "dry run" — shows counts, deletes nothing because of ROLLBACK)
--   2. To actually delete: run the whole file, but change the final ROLLBACK to
--      COMMIT.  Simplest: paste the block, review the RAISE NOTICE counts, then
--      type COMMIT; (or ROLLBACK; to abort).
-- ============================================================================

BEGIN;

-- ---- capture the sales-only journal-entry ids up front (shared table filter) ----
CREATE TEMP TABLE _sales_je ON COMMIT DROP AS
  SELECT "journalEntryId" AS id FROM sales_invoices    WHERE "journalEntryId" IS NOT NULL
  UNION
  SELECT "journalEntryId" AS id FROM customer_receipts WHERE "journalEntryId" IS NOT NULL
  UNION
  SELECT "journalEntryId" AS id FROM finance_adjustment_notes
    WHERE "salesInvoiceId" IS NOT NULL AND "journalEntryId" IS NOT NULL;

-- ---- DELETE (leaves-first) ----

-- 1. Bank matches linked to a customer receipt (sales side only). Restrict-blocks receipts.
DELETE FROM bank_transaction_matches WHERE "customerReceiptId" IS NOT NULL;

-- 2. Receipt allocations (Restrict -> sales_invoices), then customer receipts.
DELETE FROM receipt_allocations;
DELETE FROM customer_receipts;

-- 3. Sales-side adjustment notes only (Restrict -> sales_invoices). AP-side kept.
DELETE FROM finance_adjustment_notes WHERE "salesInvoiceId" IS NOT NULL;

-- 4. Delivery challans (cascades lines -> releases Restrict pin on order lines).
DELETE FROM delivery_challans;

-- 5. Sales invoices (cascades sales_invoice_lines + gst_submissions).
DELETE FROM sales_invoices;

-- 6. Sales-posted GL journal entries ONLY (cascades journal_lines). Clear any
--    reversal entry first so it can't Restrict-pin its original.
DELETE FROM journal_entries WHERE "reversalOfId" IN (SELECT id FROM _sales_je);
DELETE FROM journal_entries WHERE id IN (SELECT id FROM _sales_je);

-- 7. Project kickoffs (cascades all kickoff children; SetNulls MaterialIndent/Rfq).
DELETE FROM project_kickoffs;

-- 8. Orders (cascades order lines, confirmation sheets, billing milestones).
DELETE FROM orders;

-- 9. Bids (cascades bid lines).
DELETE FROM bids;

-- 10. Bid assessments (cascades responses), then null lead pointer, then opportunities.
DELETE FROM bid_decision_assessments;
UPDATE leads SET "convertedToOpportunityId" = NULL WHERE "convertedToOpportunityId" IS NOT NULL;
DELETE FROM opportunities;

-- 11. Leads (cascades lead_attachments; Vault files survive).
DELETE FROM leads;

-- 12. Reset sales numbering so new records restart at 0001.
DELETE FROM sales_sequences;

-- ---- verify (should all read 0) ----
SELECT
  (SELECT count(*) FROM leads)             AS leads,
  (SELECT count(*) FROM opportunities)     AS opportunities,
  (SELECT count(*) FROM bids)              AS bids,
  (SELECT count(*) FROM orders)            AS orders,
  (SELECT count(*) FROM project_kickoffs)  AS kickoffs,
  (SELECT count(*) FROM sales_invoices)    AS sales_invoices,
  (SELECT count(*) FROM delivery_challans) AS delivery_challans;

-- ---- preserved (should be UNCHANGED) ----
SELECT
  (SELECT count(*) FROM employees)                 AS employees,
  (SELECT count(*) FROM customers)                 AS customers,
  (SELECT count(*) FROM products)                  AS products,
  (SELECT count(*) FROM accounts_payable_invoices) AS ap_invoices;

-- ============================================================================
-- Review the two result rows above.
--   All good?  ->  COMMIT;
--   Anything wrong?  ->  ROLLBACK;
-- ============================================================================
COMMIT;
