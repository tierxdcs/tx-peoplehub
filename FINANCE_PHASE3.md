# Finance Phase 3 — Accounts Payable and Payment Planning

Phase 3 adds the vendor-liability and outbound-payment side of PhazeOne — Phaze ERP. It uses the Phase 1 ledger and sole Finance/Accounts Head capability, and integrates with the existing Purchase Order and QC-gated GRN workflows.

## Delivered scope

- Vendor Invoice Register for both qualified Suppliers and Vendors.
- Duplicate supplier-invoice detection per payable party.
- INR base currency with USD, CAD and EUR plus mandatory INR conversion rate.
- Input GST split into CGST, SGST and IGST, reconciled to line-level tax.
- TDS deduction and posting to TDS Payable.
- Three-way match against the PO price and accepted GRN quantity. Received-but-rejected material is never billable as an accepted receipt.
- Match exceptions are routed to the Finance Head and require a recorded override reason.
- Non-PO expense invoices are supported and posted to Administrative Expenses.
- Finance-user submit and sole Finance Head approve/reject workflow.
- Payment proposals, invoice allocations, supplier advances, approval, execution and UTR/bank reference capture. This records bank activity without direct bank integration.
- Vendor-wise AP outstanding/overdue summary.
- Released PO commitment report showing ordered, QC-accepted, billed, unreceived and unbilled values.
- Combined Payment Calendar for AR due dates, AP due dates and proposed/approved vendor payments.
- Automatic posted journals for approved AP invoices and executed payments..

## Key controls

- Finance users can prepare and submit but cannot approve.
- Only the Super Admin-designated Finance/Accounts Head can approve.
- A Finance Head cannot approve a bill or payment they created.
- A payment cannot be allocated above an invoice's outstanding balance.
- Each invoice can appear only once in a payment proposal.
- Only approved invoices can be paid and only approved payments can be executed.
- Closed accounting periods reject automatic postings.
- AP invoice approval posts Inventory for PO-backed material bills or Administrative Expense for non-PO bills, Input GST, Accounts Payable and TDS Payable.
- Executed payments post Accounts Payable and/or Supplier Advances against Cash and Bank.

## Main API routes

- `GET/POST /finance/ap/invoices`
- `POST /finance/ap/invoices/:id/submit|approve|reject`
- `GET/POST /finance/ap/payments`
- `POST /finance/ap/payments/:id/submit|approve|reject|execute`
- `GET /finance/ap/summary`
- `GET /finance/ap/po-commitments`
- `GET /finance/ap/payment-calendar?from=YYYY-MM-DD&to=YYYY-MM-DD`

## UI routes

- `/finance/ap/invoices`
- `/finance/ap/payments`
- `/finance/ap/summary`
- `/finance/payment-calendar`

## Recommended next phase

Phase 4 should add credit/debit notes, GST purchase register and ITC reconciliation, TDS section/rate configuration and quarterly return support, payment holds/disputes, recurring expenses, AP aging buckets and exports, cash-flow forecasting, period close controls, audit exports, and GST provider certification. Direct bank integration remains excluded by design.
