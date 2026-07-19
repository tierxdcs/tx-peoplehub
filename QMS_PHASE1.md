# QMS Phase 1 — Foundation

## Delivered

- Sole `QMS Head` capability, assigned and revoked by Super Admin.
- Existing `QC Inspector` capability reused for operational quality users.
- QMS access does not grant approval: only the explicitly assigned QMS Head approves.
- Dashboard with open work, review queue, failures and first-pass yield.
- Versioned question templates for incoming, in-process, final, FAT, pre-dispatch and audit use cases.
- Supported response types include pass/fail, yes/no, text, measurements, choices, ratings, evidence and signatures.
- Template maker-checker submission and approval workflow.
- Quality Plans / Inspection and Test Plans with configurable review, witness and hold stages.
- Approved-template enforcement for quality-plan stages.
- Inspection engine with GRN, product, order, kickoff, batch/serial and assignment references.
- Immutable template/question snapshot on every inspection.
- Required-answer validation and QMS Head result review.
- UI routes: `/qms`, `/qms/templates`, `/qms/plans`, `/qms/inspections`, and inspection execution detail.

## Deliberate Phase 1 boundaries

- Existing Stores NCR remains authoritative and is not duplicated.
- Phase 2 will generalize the NCR source model and add CAPA/root-cause/action tracking.
- Phase 3 will add audit programmes and full audit execution using the template engine.
- Phase 4 will add immutable QC report revisions, PDF generation and internal/customer signatures.
- Phase 5 will add calibration, complaints, supplier scorecards and extended KPIs.

