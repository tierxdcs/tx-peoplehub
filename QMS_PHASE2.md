# QMS Phase 2 — NCR and CAPA

## Delivered

- Unified QMS NCR register for inspection, GRN, audit, customer complaint, calibration and manual sources.
- Existing Stores/GRN NCRs are mirrored into the QMS register without changing their original NCR numbers or Stores workflow.
- Automatic NCR creation when the QMS Head rejects an inspection.
- NCR severity, owner, target date, containment, disposition and lifecycle tracking.
- Supported dispositions: rework, repair, use-as-is, return to supplier, scrap and concession.
- QMS Head approval for disposition and final CAPA effectiveness; operational QMS users cannot self-approve these controls.
- CAPA records with 5-Why analysis, root-cause conclusion and measurable effectiveness criteria.
- Assigned corrective/preventive actions with due dates, completion evidence and QMS Head verification.
- CAPA cannot enter effectiveness review until every action is verified.
- Effective CAPA review closes both CAPA and NCR; ineffective review returns the CAPA for further action.
- Daily overdue-action detection and in-app notification for assigned users.
- Dashboard indicators for open NCRs, open CAPAs and overdue actions.
- UI routes: `/qms/ncrs`, `/qms/ncrs/[id]` and `/qms/capas`.

## Workflow

1. A quality user raises an NCR, or the system creates/mirrors one from an inspection or Stores NCR.
2. The owner records immediate containment.
3. The QMS Head selects and approves the disposition.
4. A quality user creates a CAPA when corrective action is required.
5. Action owners complete assigned actions and attach completion evidence.
6. The QMS Head verifies each action.
7. A quality user submits the CAPA for effectiveness review.
8. The QMS Head marks it effective or ineffective. Effective closes the CAPA and NCR.

## Deliberate boundaries

- Stores remains authoritative for its GRN NCR workflow; QMS provides the unified quality view.
- Phase 3 will add audit programmes, schedules, auditee assignments, template-based audit execution and audit findings linked to this NCR/CAPA engine.
- Phase 4 will add immutable QC report revisions, PDF generation and internal/customer signatures.
- Phase 5 will add calibration, complaints, supplier scorecards and extended quality KPIs.
