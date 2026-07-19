# Finance Phase 6C — Executive Reporting and Year End

Phase 6C provides read-only executive reporting, immutable management-pack
snapshots, auditor access, and controlled April–March financial-year rollover.

## Delivered

- Executive KPIs: revenue, profit, cash, receivables, payables, overdue AR and DSO.
- Direct cash-flow statement with opening cash, operating, investing, financing,
  unclassified movements, net change and closing cash.
- Finance Head-maintained cash-flow category on ledger accounts. Ambiguous or
  unmapped journals remain visible as `UNCLASSIFIED`.
- Balance-sheet schedule by account with an accounting-equation difference.
- Snapshot management packs with maker/Finance Head approval and publication.
- Time-bound, read-only auditor grants assigned/revoked only by Super Admin.
- Auditor access is accepted only by reporting APIs; it does not authorize
  journals, invoices, payments, approvals, settings, or other finance mutations.
- Controlled rollover after all 12 source periods are closed.
- Balance-sheet opening-balance snapshot and current-year profit transfer to a
  selected retained-earnings account.
- Finance Head rollover approval with self-approval prevention.
- Executive workspace at `/finance/executive`.

## Important boundaries

- Opening balances are an auditable rollover snapshot. Posted journals remain
  the detailed source of truth and are never rewritten.
- Cash-flow accuracy depends on completing ledger-account mappings.
- Management packs preserve their source snapshot after submission.

## Recommended next increment

Phase 7 should focus on production hardening: configurable control-account
mappings, scheduled background jobs, notifications, import templates, audit
exports, performance testing, security review, and deployment runbooks.
