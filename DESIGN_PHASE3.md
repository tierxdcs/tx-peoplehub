# Design Engineering Phase 3

## Delivered

- Engineering Change Request/Order register linked to Design Projects.
- Change classification, priority, reason, proposed solution, coordinator and target date.
- Affected-record register for design revisions, BOMs, items, inventory, WIP, purchase orders, sales orders and other references.
- Revision effectivity by immediate release, next production run, date, serial number or lot number.
- Inventory and WIP disposition control: use as-is, rework, scrap, return to vendor, hold or not applicable.
- Cross-functional impact assessment across Design, BOM, Inventory, WIP, Procurement, Production, Quality, Cost, Schedule and Customer.
- Individually assigned impact owners with assessment conclusions and required actions.
- Design Head approval with maker-checker protection and signature snapshot.
- Downstream implementation acknowledgement by named functions and employees.
- Design Head closure only after all required acknowledgements are complete.
- Production-release gate that blocks a Design Project while any engineering change remains open.
- Dashboard count for open engineering changes.
- UI routes: `/design/changes` and `/design/changes/[id]`.

## Workflow

`DRAFT → IMPACT_ASSESSMENT → PENDING_APPROVAL → APPROVED → IMPLEMENTING → CLOSED`

A Design Head can reject a change from `PENDING_APPROVAL`. A rejected change remains in the immutable change register with its reason.

## Approval gates

An ECR cannot be submitted for approval until:

1. At least one affected record has been identified.
2. Every impact area has a completed assessment.
3. Every affected record has a stock/WIP disposition.
4. At least one downstream acknowledgement owner has been assigned.

The Design Head cannot approve an ECR they requested. Closure requires every downstream acknowledgement to be completed and an implementation summary to be recorded.

## Recommended next phase

Phase 4 should add controlled design review meetings, review minutes and action tracking, reusable project/design templates, document transmittals, and generated engineering change reports suitable for customer and internal signatures.
