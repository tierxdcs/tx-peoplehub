# QMS Phase 5 — Operational Quality Controls

## Calibration and measuring equipment

- Measuring-equipment register with equipment code, serial number, range, least count, location and custodian.
- Configurable calibration frequency and next-due date.
- Automatic due-within-30-days and overdue status calculation.
- Calibration history with agency, certificate number, evidence metadata, observed results and remarks.
- Pass, fail and limited-use results.
- QMS Head review of every calibration record.
- Accepted failed calibration automatically takes the equipment out of service and raises a linked NCR.

## Customer complaints

- Customer complaint register with severity, owner, target date, reported-by details and immediate action.
- Every registered complaint automatically creates a traceable NCR.
- Investigation/root-cause narrative and documented response to the customer.
- QMS Head-only complaint closure with a verification note.
- Complaint and NCR/CAPA lifecycles remain linked but independently traceable.

## Supplier quality

- Live supplier scorecards derived from PO/GRN receipt history and QMS supplier audits.
- Incoming acceptance rate and rejection PPM.
- Major/minor audit-finding penalties.
- 0–100 quality score and Preferred, Approved, Conditional or Improvement Required rating.
- Existing SCM supplier qualification remains authoritative and is shown alongside operational quality performance.

## Analytics

- Rolling 12-month inspection, failure, NCR, complaint, CAPA and calibration trends.
- Summary indicators for open NCRs, open complaints, closed CAPAs and calibration failures.
- UI routes: `/qms/calibration`, `/qms/complaints`, `/qms/supplier-quality` and `/qms/analytics`.

## Deliberate boundaries

- Certificate and signature evidence fields store provider-neutral metadata; binary files continue to belong in the existing Vault/storage layer.
- Supplier quality scoring is intentionally transparent and lightweight. Weight configuration and supplier corrective-action portals can be added later if business volume justifies them.
- Regulated electronic signatures, external customer portals and automated laboratory integrations require separate provider/security decisions.
