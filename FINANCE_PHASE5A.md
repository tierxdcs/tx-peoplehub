# Finance Phase 5A — Bank Reconciliation, Exports and Audit Pack

Phase 5A adds operational reconciliation and audit evidence without live bank integration. Finance users upload bank-provided CSV files; the ERP validates, suggests matches and routes the completed reconciliation to the sole Finance/Accounts Head.

## Delivered scope

- Finance Head-managed INR bank-account register linked to the Chart of Accounts.
- UTF-8 CSV import up to 5 MB with quoted-field support.
- Accepted dates: `YYYY-MM-DD` and `DD/MM/YYYY`.
- Required headers: `date`, `description`, `debit`, `credit`; `reference`, `value_date` and `balance` are supported.
- Opening balance plus credits minus debits must equal the stated closing balance.
- Duplicate files are rejected using a SHA-256 hash scoped to the bank account.
- Exact amount plus UTR/reference suggestions for posted customer receipts and executed vendor payments.
- Manual candidate matching within a seven-day window.
- Each ERP receipt, payment or journal can reconcile only once.
- Documented unmatched exceptions.
- Finance-user preparation and Finance Head approval with self-approval prevention.
- CSV downloads for General Ledger, AR, AP and bank reconciliation.
- Consolidated JSON audit pack containing ledger, receivables, payables, reconciliations and adjustment notes.
- Database checks for statement dates, debit/credit integrity, unmatched reasons, match targets and confidence scores.

## CSV template

```csv
date,value_date,description,reference,debit,credit,balance
2026-07-01,2026-07-01,Customer receipt,UTR1001,0,118000,618000
2026-07-02,2026-07-02,Vendor payment,UTR1002,59000,0,559000
```

Each row must contain either a positive debit or a positive credit, never both.

## Main API routes

- `GET/POST /finance/operations/bank-accounts`
- `GET /finance/operations/statements`
- `POST /finance/operations/statements/import`
- `GET /finance/operations/statements/:id`
- `POST /finance/operations/statements/:id/submit|approve|reject`
- `GET /finance/operations/statement-lines/:id/candidates`
- `PATCH /finance/operations/statement-lines/:id/match`
- `PATCH /finance/operations/statement-lines/:id/confirm-suggestion`
- `PATCH /finance/operations/statement-lines/:id/accept-unmatched`
- `GET /finance/operations/exports/:kind`
- `GET /finance/operations/audit-pack`

## UI routes

- `/finance/bank-reconciliation`
- `/finance/exports`

## Deliberate boundaries

- No live bank API, credential storage or payment initiation.
- CSV is the statement interchange format for this increment. Bank-specific XLSX layouts can be normalized to CSV before upload.
- PDF financial statements and signed archive bundles are presentation and document-signing increments.

## Recommended Phase 5B

Add budgets and budget-versus-actual reporting, fixed assets and depreciation, recurring journals, accruals and prepayments, inventory valuation and COGS automation, and project/department profitability.
