# Design Engineering Phase 2

## Delivered

- Structured, project-linked design inputs with category, source, acceptance criteria and verification method.
- Requirement verification outcomes with evidence summaries and verified-by audit data.
- Project milestones and deliverables with owner, due date and controlled status.
- Independent technical checking before Design Head approval.
- Separation of duties: a revision's preparer cannot check it, and its Design Head releaser cannot be its preparer or checker.
- Optional customer-approval requirement per revision, with customer name, approval date, reference and evidence.
- Release blocking when required customer approval has not been recorded as approved.
- Production-release gates requiring all controlled documents to be released, all applicable required inputs to be verified, and all milestones to be completed or cancelled.
- A Design Controls page at `/design/controls` for requirements, verification and milestones.
- Document Register actions for independent checking and customer-approval evidence.

## Revision workflow

`DRAFT → PENDING_CHECK → PENDING_APPROVAL → RELEASED`

- A design user prepares and submits the revision.
- A different design user performs the independent technical check.
- The Design Head releases or rejects the checked revision.
- Customer approval must be recorded before release when the revision requires it.

## Production-release readiness

A project can move to production only when:

1. Every registered controlled document has a released revision.
2. Every applicable required design input is verified.
3. Every milestone is completed or explicitly cancelled.
4. The action is performed by the assigned Design Head.

## Recommended next phase

Phase 3 should introduce Engineering Change Requests/Orders, multidisciplinary impact assessment, disposition of affected inventory and work in progress, effectivity control, and acknowledgement by downstream functions.
