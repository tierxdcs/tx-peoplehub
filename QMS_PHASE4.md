# QMS Phase 4 — Controlled Reports and Signatures

## Delivered

- Controlled quality reports generated from reviewed inspections or closed audits.
- Immutable source snapshot containing checklist responses, results, evidence references, NCRs/findings and conclusions.
- Sequential report numbering and revision control.
- Old revisions are retained and marked superseded rather than overwritten.
- Mandatory reason when generating a revised report.
- QMS Head internal signature with signer name, signature text/font and timestamp snapshots.
- Optional customer-signature workflow with signer name, designation, organisation, typed signature and timestamp.
- Reports without a customer-signature requirement execute after QMS Head signature.
- Reports requiring customer acceptance execute only after both signatures.
- Print-optimised QC/audit report with controlled-document metadata and both signature blocks.
- Browser Download PDF / Save as PDF using the application's established printable-document mechanism.
- Dashboard indicators for pending signatures and executed reports.
- UI routes: `/qms/reports` and `/qms/reports/[id]`.

## Workflow

1. A quality user selects a reviewed inspection or closed audit and generates a report.
2. The system freezes the source data into an immutable revision.
3. The QMS Head applies their configured internal signature.
4. If customer acceptance is required, a quality user records the customer's signed acceptance details.
5. The executed report can be downloaded through the browser's PDF print workflow.
6. Any correction creates a new revision and preserves the earlier revision as superseded.

## Signature note

The internal typed signature follows the ERP's existing order-confirmation signature convention. Customer signature evidence can also be stored through the API. A future integration may add OTP-based external signing or a regulated digital-signature provider if legally binding electronic execution is required.

## Next phase

Phase 5 will add calibration and measuring-equipment controls, customer complaints, supplier quality scorecards and extended quality analytics.
