# QMS Phase 3 — Audit Management

## Delivered

- Annual audit programmes aligned to the April–March Indian financial year.
- Internal, process, supplier, product, 5S and custom audit types.
- Programme scope, criteria, department/process, schedule, lead auditor, auditee and approved question-template assignment.
- Draft, submission and QMS Head approval workflow with maker-checker protection.
- Automatic creation of scheduled audits when a programme is approved.
- Standalone audit API for unplanned or special audits.
- Immutable template and question snapshot for every scheduled audit.
- Lead-auditor-only start and completion controls.
- Checklist responses, objective evidence, clause references, conclusions and classified findings.
- Finding classifications: conformity, observation, opportunity for improvement, minor nonconformity and major nonconformity.
- Automatic linked NCR creation for minor and major audit nonconformities.
- Finding owner and target date enforcement for nonconformities.
- QMS Head review and closure of completed audits.
- Dashboard indicators for scheduled, pending-review and overdue audits.
- UI routes: `/qms/audit-programs`, `/qms/audits` and `/qms/audits/[id]`.

## Workflow

1. A quality user builds an annual programme using approved audit templates.
2. The programme is submitted to the QMS Head.
3. The QMS Head approves it; each programme item becomes a scheduled audit.
4. The assigned lead auditor starts and executes the frozen checklist.
5. Findings and objective evidence are recorded; nonconformities create NCRs automatically.
6. The lead auditor submits the audit conclusion for review.
7. The QMS Head reviews and closes the audit.
8. Linked NCRs and CAPAs continue independently through the Phase 2 workflow.

## Deliberate boundaries

- Phase 4 will add immutable QC/audit report revisions, PDF generation and internal/customer signatures.
- Phase 5 will add calibration, customer complaints, supplier quality scorecards and extended trend analytics.
