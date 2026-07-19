# Finance & Accounts — Phase 2 Accounts Receivable

This increment builds the AR subledger on the Phase 1 double-entry journal.

## Implemented

- Structured order billing milestones with percentage-or-fixed-value controls
  and prevention of cumulative milestones exceeding order value.
- Sales Invoice Register with customer/order/milestone references, immutable
  customer/address/GST snapshots, INR/USD/CAD/EUR, line-level HSN/SAC,
  discounts, CGST/SGST/IGST, due dates, and outstanding balances.
- Accounts-user preparation and sole Finance Head approval/rejection.
- Self-approval prevention.
- B2B GST e-invoice outbox with idempotency, attempts, failure state, IRN,
  acknowledgement and signed-QR persistence.
- E-way-bill outbox with transporter, transport-document, vehicle and distance
  data plus number/validity persistence.
- Provider-neutral HTTPS GST gateway contract configured by
  `GST_GATEWAY_URL` and `GST_GATEWAY_TOKEN`. No secret is stored in source.
- Customer receipts, TDS, bank charges, invoice allocation and unapplied
  customer advances.
- Automatic balanced INR journal posting on invoice issue and receipt approval.
- Customer-wise outstanding, advances, overdue totals and aging buckets.
- Functional Sales Invoice Register, Customer Receipts and AR Summary screens.

## Accounting postings

Sales invoice:

- Dr Accounts Receivable (1100)
- Cr Sales Revenue (4000)
- Cr Output GST (2100)

Customer receipt:

- Dr Cash and Bank (1000)
- Dr TDS Receivable (1400), when applicable
- Dr Administrative Expenses (6100), for bank charges
- Cr Accounts Receivable (1100), for allocated value
- Cr Customer Advances (2300), for unapplied value

Foreign-currency documents store the original amount and effective INR rate;
the journal snapshots the INR equivalent. Realized/unrealized FX workflows are
still part of the later close implementation.

## GST integration boundary

The ERP sends a provider-neutral request to an authorized GSP/IRP adapter. The
adapter is responsible for provider authentication/encryption and must return
normalized IRN/e-way fields. Failed attempts remain retryable and never issue
or post a B2B invoice prematurely.

Before production use, configure the legal entity/GST settings through the AR
settings API, select an authorized provider, validate its adapter contract,
and complete sandbox certification.

## Remaining Phase 2 completion work

- Credit/debit notes and GST cancellation flows
- Invoice PDF containing the signed QR and statutory fields
- Structured invoice editing before submission
- Customer statements and downloadable register exports
- Automated overdue-status scheduler and reminder workflow
- Production GSP adapter certification and webhook/security hardening

These items are intentionally identified rather than represented as complete;
financial and GST corrections must not be implemented as unsafe edits to issued
documents.
