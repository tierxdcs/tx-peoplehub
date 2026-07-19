# Finance Phase 6B — FX, Credit, Advances and Provisions

Phase 6B adds period-end foreign-currency accounting and working-capital
controls while retaining the single Finance Head approval model.

## Delivered

- Document-level period-end FX revaluation for open USD, CAD and EUR AR/AP.
- Closing-rate snapshot, original carrying amount, revalued amount, and gain or
  loss per document.
- Maker/Finance Head approval and self-approval prevention for FX runs.
- Posted revaluation journals against AR/AP control accounts and configured FX
  gain/loss accounts.
- Explicit next-period FX reversal with a linked reversal journal.
- Realized FX gain/loss posting when foreign-currency receipts or vendor
  payments settle invoices at a rate different from their original rate.
- Finance Head-maintained realized FX gain and loss account mapping.
- Customer credit limits, overdue grace days, review dates, and block settings.
- Sales-invoice submission gate for limit and overdue violations.
- Reasoned Finance Head invoice override retained on the invoice.
- Customer advances sourced from posted unapplied receipts.
- Vendor advances sourced from executed unallocated payments.
- Controlled advance application against a same-party open invoice, with
  availability validation, journal posting, and invoice balance/status update.
- `PROVISION` added to the existing approved recurring schedule framework.
- Treasury & Credit workspace at `/finance/treasury`.

## Control accounts

- Customer advances: `2300`
- Supplier advances: `1500`
- Accounts receivable: `1100`
- Accounts payable: `2000`

FX gain and FX loss accounts are selected for each run instead of being
hard-coded. They should normally be configured as other-income and
other-expense accounts.

## API

- `GET /finance/treasury`
- `POST /finance/treasury/credit-controls`
- `POST /finance/treasury/fx-settings`
- `GET /finance/treasury/credit-controls/:customerId/exposure`
- `POST /finance/treasury/invoices/:id/credit-override`
- `POST /finance/treasury/fx-runs`
- `POST /finance/treasury/fx-runs/:id/submit|approve|reverse`
- `POST /finance/treasury/advances/apply`

## Recommended Phase 6C

Executive finance dashboards, cash-flow statement, balance-sheet schedules,
management reporting packs, auditor access, and controlled year-end rollover.
