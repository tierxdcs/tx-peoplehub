# Finance Phase 5B — Management Accounting and Automation

Phase 5B adds planning, asset accounting, controlled recurring postings, inventory-cost visibility and project profitability to WorkCore — Phaze ERP.

## Delivered scope

- April–March budgets with monthly ledger, cost-centre and project dimensions.
- Finance-user preparation and sole Finance Head approval.
- Budget-versus-actual reporting from posted journal lines.
- Fixed-asset register with cost, residual value, useful life, location and account mappings.
- Finance Head capitalisation approval and automatic capitalisation journal.
- Straight-line monthly depreciation with one entry per asset and accounting period.
- Approved monthly recurring journals, accruals and prepayment schedules.
- Schedule preflight across every required period before any posting, preventing partial batches when a period is closed.
- Historical on-hand reconstruction from append-only stock movements.
- Estimated weighted-average inventory valuation using QC-accepted GRN quantities and snapshotted PO prices.
- Project profitability using invoiced taxable revenue, project-coded expense/COGS journals and estimated material-issue cost.
- Database constraints for positive budget, asset, depreciation and schedule values.

## Key controls

- Finance Head cannot approve a budget, asset or schedule they created.
- Only approved budgets contribute to variance reports.
- Capitalisation and automated postings require an open accounting period.
- Depreciation is idempotent per asset and period.
- Accumulated depreciation cannot exceed depreciable value.
- Recurring schedule debit and credit accounts must differ.
- Every due schedule period is validated before the batch starts.
- Scheduled journals retain the approved template, cost centre and project reference.

## Inventory valuation limitation

The stock subsystem historically records quantities but not perpetual monetary cost layers. Phase 5B therefore provides an explicitly labelled estimate:

1. accepted GRN quantity × PO line price establishes receipt cost;
2. cumulative accepted receipt value ÷ cumulative accepted receipt quantity establishes weighted average cost; and
3. reconstructed on-hand quantity as of the report date × weighted average cost establishes estimated inventory value.

This report does not claim FIFO or statutory perpetual valuation. A future inventory-accounting phase can persist cost layers and automatically post COGS at each material/finished-goods issue.

## Main API routes

- `GET/POST /finance/management/budgets`
- `POST /finance/management/budgets/:id/submit|approve|reject`
- `GET /finance/management/budgets/:id/variance`
- `GET/POST /finance/management/assets`
- `POST /finance/management/assets/:id/submit|approve|reject`
- `POST /finance/management/assets/run-depreciation`
- `GET/POST /finance/management/schedules`
- `POST /finance/management/schedules/:id/submit|approve|reject`
- `POST /finance/management/schedules/run-due`
- `GET /finance/management/reports/inventory-valuation`
- `GET /finance/management/reports/project-profitability`

## UI routes

- `/finance/budgets`
- `/finance/fixed-assets`
- `/finance/management`

## Recommended Phase 5C

Add certified GST/GSP connectivity, automated GSTR-1/GSTR-3B/GSTR-2B exchange, GST cancellation and amendment, TDS return files and Form 16A records, provider retry monitoring, and compliance filing evidence.
