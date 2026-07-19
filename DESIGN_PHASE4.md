# Design Engineering Phase 4

## Delivered

- Formal design-review register covering requirements, concept, preliminary, critical, manufacturing-readiness, change and final reviews.
- Scheduled chairperson, location/meeting link, objectives, attendees, attendance, minutes and recorded decisions.
- Review action tracking with owner, due date, completion evidence and Design Head verification.
- Design Head closure gate requiring minutes, a decision and all actions verified or cancelled.
- Reusable Design Project Templates containing standard design inputs and milestone packs.
- Design Head template approval with maker-checker protection.
- Applying an approved template creates numbered project requirements and scheduled milestones from a selected start date.
- Controlled document transmittals containing immutable snapshots of released document numbers, titles and revisions.
- Design Head signature snapshot when a transmittal is issued, followed by recipient acknowledgement.
- Immutable Engineering Change Reports generated from approved ECR/ECO records.
- Report revision control, internal Design Head signature and optional customer signature.
- Printable/downloadable PDF layout consistent with the existing QMS report convention.
- UI routes: `/design/reviews`, `/design/templates`, `/design/transmittals`, `/design/change-reports` and `/design/change-reports/[id]`.

## Design review workflow

`SCHEDULED → IN_PROGRESS → PENDING_CLOSURE → CLOSED`

Review closure is blocked until meeting minutes and the review decision are recorded and every action is verified or cancelled.

## Transmittal workflow

`DRAFT → ISSUED → ACKNOWLEDGED`

Only released design-document revisions from the selected project can be transmitted. The issued record retains document and revision snapshots even if later revisions are released.

## Engineering change report workflow

`AWAITING_INTERNAL_SIGNATURE → AWAITING_CUSTOMER_SIGNATURE → EXECUTED`

The customer-signature step is skipped when it is not required. Creating a report revision supersedes the previous report while preserving its frozen payload and signatures.

## Recommended next phase

Phase 5 should add design-resource capacity planning, effort/time booking, design KPI analytics, overdue escalation notifications, and portfolio-level workload forecasting.
