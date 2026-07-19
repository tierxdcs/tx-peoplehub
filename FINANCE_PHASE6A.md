# Finance Phase 6A — Close Automation and Reconciliations

Phase 6A strengthens the existing maker-checker period close with repeatable
tasks and evidence-based automated controls. Finance users prepare and resolve;
the designated Finance Head remains the only approver and the only person who
can waive an exception.

## Delivered

- Nine reusable close tasks covering transaction cut-off, bank, AR, AP, GST,
  TDS, accounting adjustments, reconciliations, and management review.
- Automated reconciliation run for each prepared accounting period.
- Trial-balance debit/credit integrity check.
- AR and AP control-account versus open-subledger reconciliation.
- Output GST, input GST, and TDS payable versus source-register reconciliation.
- Unresolved bank-statement-line and overdue-compliance checks.
- Persistent exceptions with severity, ledger/source values, variance,
  assignment field, resolution note, resolver, and timestamp.
- Finance user resolution and Finance Head-only waiver.
- Required incomplete tasks and open blocking exceptions prevent close submit.
- Recheck for blocking exceptions immediately before Finance Head approval.
- Period Close UI for running controls, completing tasks, resolving exceptions,
  and recording controlled waivers.

## API

- `GET /finance/close-controls/:periodId`
- `POST /finance/close-controls/:periodId/run`
- `PATCH /finance/close-controls/:periodId/tasks/:taskId`
- `PATCH /finance/close-controls/exceptions/:id/resolve`

## Accounting assumptions

The reconciliation engine uses the seeded control accounts:

- `1100` Accounts Receivable
- `2000` Accounts Payable
- `1300` Input GST
- `2100` Output GST
- `2200` TDS Payable

The tolerance is INR 0.01. Organizations changing the chart of accounts should
move these mappings into a configurable control-account mapping before doing so.

## Recommended Phase 6B

Foreign-currency period-end revaluation, realized/unrealized FX accounting,
customer/vendor advances, provisions, and customer credit controls.
