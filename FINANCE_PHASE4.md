# Finance Phase 4 — Compliance, Adjustments and Period Close

Phase 4 extends PhazeOne — Phaze ERP from transaction processing into statutory review, controlled adjustments, cash planning and month-end governance for the India-only, April–March finance setup.

## Delivered scope

- Unified AR/AP credit-note and debit-note register.
- Finance-user preparation and sole Finance Head approval with self-approval prevention.
- Automatic balanced journal posting and invoice-outstanding adjustment after approval.
- GST Purchase Register with supplier GSTIN snapshots and CGST, SGST and IGST values.
- GSTR-2B-oriented ITC states: pending, matched, mismatched, ineligible and deferred.
- Mandatory explanation for ITC mismatches.
- Configurable TDS section, rate, threshold and effective dates.
- AP aging buckets: current, 1–30, 31–60, 61–90, 91–180 and over 180 days.
- Finance Head payment holds/disputes with mandatory reason and controlled release.
- Weekly INR cash forecast combining expected customer collections, due payables and planned vendor payments.
- Period-close checklist, live blocker counts, Finance-user preparation, Finance Head approval and final posting lock.
- Database checks for adjustment-note invoice linkage, note totals and TDS configuration values.

## Period-close blockers

The system prevents submission while the selected period contains unresolved:

- draft, rejected or pending journals;
- sales invoices awaiting approval or GST processing;
- AP invoices awaiting match or approval;
- receipts or vendor payments awaiting processing;
- adjustment notes awaiting approval; or
- purchase invoices with pending or mismatched ITC.

The preparer must also confirm bank reconciliation, GST review, TDS review, accrual review and management-review readiness. Submission soft-closes the period. Finance Head approval changes it to `CLOSED`, after which automatic and manual posting services reject entries in that period.

## Main API routes

- `GET/POST /finance/compliance/notes`
- `POST /finance/compliance/notes/:id/submit|approve|reject`
- `GET/POST /finance/compliance/tds-sections`
- `PATCH /finance/compliance/ap-invoices/:id/itc`
- `PATCH /finance/compliance/ap-invoices/:id/payment-hold`
- `GET /finance/compliance/gst-purchase-register`
- `GET /finance/compliance/ap-aging`
- `GET /finance/compliance/cash-forecast`
- `GET /finance/compliance/period-close/:periodId`
- `POST /finance/compliance/period-close/:periodId/prepare|submit|approve`

## UI routes

- `/finance/adjustments`
- `/finance/compliance`
- `/finance/period-close`

## Deliberate boundaries

- GSTR-2B reconciliation is a controlled status workflow; automated GST portal ingestion requires a certified GSP/ASP provider and credentials.
- Reports return structured, export-ready data. Branded PDF/XLSX generation can be added as a presentation increment.
- Direct bank integration remains excluded. Bank reconciliation is represented as a close confirmation and UTR references remain manually recorded.
- TDS return-file generation and quarterly filing are not submitted externally by this phase.

## Recommended Phase 5

Add certified GST/GSP connectivity, automated GSTR-1/GSTR-3B/GSTR-2B exchange, TDS return files and certificates, bank-statement import without live bank integration, recurring expense/accrual automation, budget-versus-actual reporting, fixed assets and depreciation, inventory valuation, and formal audit-pack PDF/XLSX generation.
