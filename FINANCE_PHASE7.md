# Finance Phase 7 — Production Readiness

## Delivered in Phase 7A

- Super Admin finance-auditor access register at `/admin/finance-auditors`.
- Time-bound grant, reactivation and revocation of read-only executive-report access.
- Auditor grants remain separate from Finance Head and Accounts-vertical permissions.
- GST gateway readiness API at `GET /finance/ar/gst-readiness`.
- GST readiness reports configuration state without returning gateway URLs or credentials.
- Missing gateway configuration continues to leave submissions safely queued.
- Super Admin operational Finance access does not grant Finance Head approval authority.

## Required environment configuration

- `GST_GATEWAY_URL`: base URL of the selected GSP/IRP adapter.
- `GST_GATEWAY_TOKEN`: provider credential stored only in the deployment secret store.

Do not place production GST credentials in committed environment files. Complete provider sandbox certification and controlled connectivity testing before enabling live submissions.

## Remaining Phase 7 production rollout

- Select and onboard the GST Suvidha Provider/IRP adapter.
- Validate provider-specific payload mapping, authentication, cancellation windows and retry codes in sandbox.
- Add scheduled management-pack delivery after email infrastructure is selected.
- Run production-volume performance, restore, security and Finance Head acceptance tests.
- Rehearse migrations and rollback procedures against a production-like database snapshot.

## Delivered in Phase 7B (provider-neutral)

- Finance production-readiness page at `/finance/production-readiness`.
- Persisted readiness assessments with blocker/deferred classification.
- Configurable GST retry attempt limit and retry cooldown.
- GST provider and scheduled email checks remain explicitly `DEFERRED`; they do not create false production failures.
- Configurable ledger control-account mapping with active-account validation.
- AR, AP, treasury, compliance posting, close reconciliation and cash-flow reporting resolve configured mappings with seeded-code fallback.
- Auditable opening-balance CSV import with required headers, balancing validation, open-period validation and duplicate-file checksum protection.
- Opening-balance imports create `DRAFT` journals and therefore still require the normal Finance Head approval/posting workflow.
- Immutable import register linking each source file to its draft journal.
- Management report-pack CSV downloads from the immutable approved snapshot.

### Opening-balance CSV

Required headers:

```csv
account_code,description,debit,credit
1000,Opening bank balance,100000,0
3000,Opening retained earnings,0,100000
```

Each row must have either a positive debit or a positive credit. Total debits must equal total credits. Re-importing the same file content is rejected.

### Infrastructure evidence still required

The application cannot truthfully mark these exercises complete on a developer workstation:

- Restore a production-like backup and record recovery time/recovery point evidence.
- Execute load and security testing with approved production-volume data.
- Complete Finance Head UAT and sign-off.
- Rehearse deployment, rollback and migration recovery in the target environment.
- Select an email service before enabling scheduled external delivery.
