# Finance & Accounts — Phase 1 foundation

Phase 1 establishes the controlled accounting core used by future AR, AP,
inventory-costing, payroll-posting, GST, budgeting, and payment workflows.

## Access model

- Active employees in the `ACCOUNTS` vertical can configure finance masters,
  prepare journals, submit them, and read reports.
- Exactly one active employee can hold `isAccountsHead`. Only `SUPER_ADMIN`
  assigns or revokes this designation; assignment atomically replaces the
  prior holder.
- Only the Accounts Head can approve/reject/post journals, change period
  status, and reverse posted journals.
- The Accounts Head cannot approve a journal they created. `SUPER_ADMIN`
  administers the designation but receives no automatic finance access.

## Accounting configuration

- Legal entity scope: India, single branch.
- Functional/reporting currency: INR.
- Enabled document currencies: INR, USD, CAD, EUR.
- Exchange rates are manual, effective-dated snapshots expressed as INR per
  one unit of foreign currency; every rate records its source and creator.
- Fiscal years run 1 April through 31 March. Creating a fiscal year generates
  twelve independently lockable monthly periods.

## Journal workflow

`DRAFT → PENDING_APPROVAL → POSTED` or `REJECTED`.

- Every line is one-sided: debit or credit, never both.
- Total debits must equal total credits and be greater than zero.
- Entry date must fall in an open accounting period.
- Posted journals are immutable and are the only source for reports.
- Corrections use a linked reversing journal; posted data is never edited or
  deleted.
- Database constraints supplement service validation and the global mutation
  audit trail.

## Reports

- General Ledger
- Trial Balance
- Accrual-basis P&L summary from posted accounts classified as Revenue, Cost
  of Goods Sold, Expense, Other Income, or Other Expense

The reports currently use INR manual journals only. Automated subledger
posting, foreign-currency realization/revaluation, comparative reporting, and
opening-balance workflows will be added with the relevant later phases.

## Phase 1 API

- `/finance/access`
- `/finance/fiscal-years`, `/finance/periods/:id/status`
- `/finance/accounts`, `/finance/cost-centers`
- `/finance/currencies`, `/finance/exchange-rates`
- `/finance/journals` and submit/approve/reject/reverse actions
- `/finance/reports/general-ledger`
- `/finance/reports/trial-balance`
- `/finance/reports/profit-and-loss`

## Deliberate exclusions

Phase 1 does not yet implement sales invoices, customer receipts, purchase
orders, GRNs, vendor bills, payments, GST IRP/e-way-bill integrations, bank
reconciliation, budgets, or automated inventory/payroll journals. Those must
post through this journal engine rather than creating independent balances.

Before production use, a qualified Indian accountant/CA must approve the Chart
of Accounts, opening balances, posting rules, GST/TDS mappings, and financial
statement presentation.
