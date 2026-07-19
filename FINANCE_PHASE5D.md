# Finance Phase 5D — Tax Operations and Filing Controls

Phase 5D closes the operational gaps identified in Phase 5C without hard-coding
tax rates or statutory dates that may change. Finance users maintain source
data and prepare records; the designated Finance Head remains the sole approver.

## Delivered

- Company PAN/TAN fields in the India finance settings.
- Supplier/vendor tax profiles with structural PAN/TAN validation and optional
  lower-deduction certificate details.
- Invoice-level TDS section, rate, taxable base, and calculated TDS amount.
- Form 26Q preparation enriched from tax profiles and invoice classifications,
  with explicit incomplete-record counts.
- TDS challan register with BSR code, deposit date, serial number, section,
  interest/fee components, and controlled return allocations.
- Allocation balance guard: allocations cannot exceed the deposited challan.
- Configurable compliance calendar and overdue/upcoming indicators. Dates are
  maintained by the Finance Head rather than embedded as permanent legal rules.
- Secure filing-document upload, confirmation, and short-lived download URLs
  through the existing R2/Vault storage boundary.
- Finance Head retry action for failed e-Invoice/e-Way Bill submissions.
- Provider-neutral cancellation endpoint for successful e-Invoices/e-Way Bills,
  requiring a reason and provider reference. The configured provider remains
  responsible for statutory cancellation-window validation.

## Main endpoints

- `POST /finance/filings/tax-profiles`
- `PATCH /finance/filings/ap-invoices/:id/tds`
- `POST /finance/filings/tds-challans`
- `POST /finance/filings/tds-challans/:id/allocate`
- `POST /finance/filings/due-dates`
- `POST /finance/filings/due-dates/:id/complete`
- `POST /finance/filings/evidence/upload-url`
- `POST /finance/filings/evidence/:id/confirm`
- `GET /finance/filings/evidence/:id/download`
- `POST /finance/ar/gst-submissions/:id/process`
- `POST /finance/ar/gst-submissions/:id/cancel`

## Important operating boundaries

- PAN/TAN validation is structural; it is not government identity verification.
- Tax sections, rates, thresholds, due dates, and lower-deduction certificates
  require review by the company tax professional.
- GST cancellation enforces the 24-hour portal window and requires a linked
  e-way bill to be cancelled before its e-invoice. It succeeds only when the
  configured ASP/GSP accepts it. Local
  references are cleared only after that successful provider response.
- Evidence is not considered present until object-storage confirmation succeeds.
