# Finance Phase 5C — Statutory Filing Workspaces

Phase 5C adds an auditable, provider-ready compliance layer for the India-only,
April–March finance setup. It prepares data from ERP books but deliberately does
not claim that a return has been filed until the Finance Head records portal or
provider acknowledgement evidence.

## Delivered

- GSTR-1 monthly preparation from issued sales invoices, including recipient,
  place-of-supply, tax totals, and HSN/SAC source lines.
- GSTR-3B preparation with outward-tax aggregates and eligible ITC restricted
  to matched, available GSTR-2B records.
- Normalized GSTR-2B JSON-row import with deterministic duplicate detection.
- Automatic GSTR-2B-to-AP matching on supplier GSTIN and invoice number, with
  exact taxable/tax comparisons and propagation to the AP ITC status.
- GST return workflow: `PREPARED → PENDING_APPROVAL → APPROVED → FILED`.
- Quarterly TDS Form 26Q preparation from approved/paid AP invoices carrying
  TDS, challan metadata, acknowledgement evidence, and Form 16A evidence.
- Finance Head is the sole approver. Finance users prepare and submit. A return
  preparer cannot approve their own return.
- Retry visibility for failed e-Invoice/e-Way Bill provider submissions.
- Filing acknowledgement/ARN and provider evidence retained independently of
  the preparation snapshot.

## Provider boundary

The existing `GstGatewayService` remains the e-Invoice/e-Way Bill provider
boundary. Phase 5C return preparation is provider-neutral. Government/ASP/GSP
submission is not enabled merely by deploying this migration; certified
provider credentials, provider-specific payload validation, sandbox testing,
and a signed operational acceptance are required first.

The TDS payload flags deductee PAN/section enrichment as required because the
current Supplier/Vendor masters do not store tax PAN and invoice-level TDS
section. This is an explicit data-quality warning, not a silent assumption.

## API

- `GET /finance/filings/dashboard?taxPeriod=YYYY-MM`
- `POST /finance/filings/gst/:type/:taxPeriod/prepare`
- `POST /finance/filings/gst/:id/submit|approve|file-evidence`
- `POST /finance/filings/gstr2b/import`
- `POST /finance/filings/gstr2b/:taxPeriod/reconcile`
- `POST /finance/filings/tds/:financialYear/:quarter/prepare`
- `POST /finance/filings/tds/:id/submit|approve|file-evidence`

UI: `/finance/filings`.

## Recommended next increment

Phase 5D should add PAN/TAN tax master data, invoice-level TDS sections,
challan allocation, provider-specific GST schema adapters, cancellation/retry
commands, signed filing-document storage, and compliance due-date alerts.
