# Design Engineering Operating Playbook

**System:** Phaze ERP  
**Audience:** Sales, Design Engineering, Design Lead, Design Head, Project Managers, SCM, Production, Quality and Super Admin  
**Purpose:** Convert a commercial or internal requirement into a controlled, checked and traceable production authority.

## The operating model

Design Engineering contains two connected workflows:

1. **Quote BOM route:** used when Sales needs a sourceable BOM to prepare a commercial quote.
2. **Controlled design-project route:** used when drawings, calculations, requirements, customer approval and formal production release must be controlled.

`Requirement → Design work → Independent check → Approval → Released revision → Controlled hand-off → Change control`

The module does not replace Sales, R&D BOM control, SCM, Production or Quality. It connects them through shared customer, product, item, BOM, order, project, Vault and audit records.

## Roles and authority

| Role | Responsibility and authority |
|---|---|
| Sales | Captures the customer need and raises a design-required BOM intake; cannot release engineering output. |
| Design Engineer | Accepts requests, creates projects, authors requirements, BOMs, drawings and revisions. |
| Independent checker | Checks a revision prepared by another person; cannot be its preparer. |
| Design Lead | Plans and coordinates the project, deliverables, dates and technical work. |
| Design Head | Sole final release authority; approves engineering changes, templates and controlled transmittals. |
| Super Admin | Assigns/revokes the sole Design Head and has operational access; is not automatically the release authority. |
| Customer | Approves the exact submitted revision when customer approval is required. |
| SCM | Sources the handed-over/released BOM and authorised technical package. |
| Production | Builds only from released revisions and acknowledges applicable changes/transmittals. |
| Quality | Participates in reviews, verifies quality impact and receives controlled releases and changes. |

Maker-checker separation is mandatory: the preparer cannot independently check their own revision, and the Design Head cannot release a revision they prepared or checked.

## Module map

| ERP page | What it controls |
|---|---|
| Design Dashboard | Open requests, active/overdue projects, pending releases, released documents and open changes. |
| Design Requests | Commercial, project, customer-change, internal-development, NCR/CAPA and value-engineering needs. |
| Quote BOM Requests | Sales-originated requirements that need Engineering to author a sourceable BOM. |
| Design Projects | Lead, target date and lifecycle from requirements to production release. |
| Design Controls | Requirements, acceptance criteria, verification evidence, milestones and deliverables. |
| Document Register | Controlled drawings/files, immutable revisions, checking, approval and release. |
| Design Reviews | Formal meetings, attendees, minutes, decisions and owned actions. |
| Engineering Changes | Post-release change impact, disposition, effectivity, approval and acknowledgement. |
| Project Templates | Approved reusable requirement and milestone packs. |
| Document Transmittals | Exact released revisions issued to named recipients with acknowledgement. |
| Change Reports | Frozen, signable reports generated from approved engineering changes. |

## Workflow A — Quote-stage BOM design

Use this route when a customer has described the required finished good but has not supplied a usable parts list.

### A1. Sales raises the design brief

**Route:** Sales → BOM Intake, or Opportunity → Customer BOM Intake

1. Choose the design-required route rather than the customer-parts-list route.
2. Enter the product name, business unit, unit of measure and the customer’s requirement.
3. Set priority and the design-needed date. If left blank, the promised-price date is used where available.
4. Select **Create Product & send to design team**.

The save is one controlled transaction: it registers the finished good/catalogue product and raises a numbered design request linked to the intake. The work appears immediately in **Quote BOM Requests**.

### A2. Design triages the request

**Route:** Design Engineering → Quote BOM Requests

1. Review the customer, opportunity, target date, priority and complete design brief.
2. Accept the request when the scope is actionable.
3. Reject it when Sales must clarify the need; communicate the reason so Sales can re-brief.
4. Link or create a Design Project when the work needs full requirements, drawings or formal controls.

### A3. Engineering authors the BOM

1. Search Item Master for every component before creating a new item.
2. Match an existing component where it represents the same controlled part.
3. Create a new component only when no correct item exists.
4. Enter quantity, unit and reference information for every line.
5. Review the finished-good structure and add a meaningful revision note.
6. Hand over the BOM.

Hand-over changes the intake from **Design Pending** to available for Sales and SCM. SCM can now create an RFQ, and supplier-award costs later attach through the sourcing process.

### A4. Commercial and SCM hand-off

- Sales sees the returned BOM in the intake and can continue the quotation process.
- SCM explodes/source-selects the BOM and attaches authorised drawings to the RFQ.
- Vendors see the technical scope but not internal cost, target margin or customer-commercial data.
- Once Engineering/R&D formally releases the BOM, Sales self-revision is closed; further changes use the controlled engineering BOM revision process.

## Workflow B — Controlled design project

### B1. Capture or accept a Design Request

**Route:** Design Engineering → Design Requests

Permitted sources include Sales Order, Project Kickoff, Customer Change, Internal Development, NCR/CAPA and Value Engineering.

Record:

- Source, clear title and full requirement/scope.
- Priority and target date.
- Customer, product and order links where applicable.
- The business reason and expected output.

Use **Accept** only when Design Engineering owns the work. Reject with clear follow-up when the scope is incomplete; close only when no project is required or the request has been formally resolved.

### B2. Create the Design Project

**Route:** Design Engineering → Design Projects

1. Select the accepted request, or create a standalone internal project.
2. Enter project name, description, lead designer and target date.
3. Link the customer, product and order where available.
4. Move through the controlled stages:

`Requirements → Concept → Detailed Design → Internal Review → Customer Approval → Released for Production`

**On Hold** pauses work without erasing it. **Closed** is administrative completion; it is not a substitute for Released for Production.

### B3. Define requirements and milestones

**Route:** Design Engineering → Design Controls

For each requirement record its category, source, requirement statement, acceptance criteria and verification method. Add evidence and a verification result against the requirement it proves.

Create milestones and deliverables with owners and due dates. Use an approved Project Template where a standard requirement/milestone pack exists.

Production release is blocked until applicable mandatory requirements are verified and every milestone is completed or explicitly cancelled.

### B4. Register documents and revisions

**Route:** Design Engineering → Document Register

Controlled document types include GA, manufacturing and assembly drawings, electrical drawings, schematics, calculations, datasheets, specifications, 3D models and work instructions.

1. Register the document against the Design Project.
2. Upload working files through Vault version control.
3. Create a formal engineering revision pinned to the exact Vault file version being submitted.
4. Submit the revision for independent check.

**Vault version** means uploaded bytes. **Engineering revision** means the immutable file version formally checked and approved. Uploading or restoring another Vault version never silently changes a released revision.

### B5. Independent technical check

Normal revision workflow:

`Draft → Pending Check → Pending Approval → Released`

The checker reviews technical correctness, completeness, manufacturability, interfaces, safety, standards, requirements and downstream usability. Failed checks return the work for revision with actionable comments.

### B6. Customer approval when required

Record the customer name, decision date, reference and approval evidence against the exact revision. A required customer approval that is missing, rejected or still pending blocks Design Head release.

Email correspondence alone is not the approval record; attach or reference the controlled evidence in ERP.

### B7. Internal design review

**Route:** Design Engineering → Design Reviews

1. Select review type and project; schedule the chair, attendees, date and location/link.
2. Record objectives, attendance, minutes and the review decision.
3. Assign every action to a named owner and due date.
4. Owners complete actions with evidence.
5. Design Head verifies or cancels each action and closes the review.

Review flow is `Scheduled → In Progress → Pending Closure → Closed`. Closure is blocked without minutes, a decision and resolution of every action.

### B8. Design Head production release

Only the designated Design Head may release. Release readiness requires:

- Every registered controlled document has a released revision.
- Applicable required design inputs are verified.
- Milestones are completed or cancelled.
- Required customer approvals are recorded.
- Required reviews/actions are closed.
- No engineering change remains open.

Release records the Design Head signature snapshot, locks the approved revision as production authority and obsoletes the previously released revision where applicable.

## Controlled transmittal

**Route:** Design Engineering → Document Transmittals

1. Select the project and named recipient/function.
2. Select only released document revisions.
3. Review the exact document/revision snapshot.
4. Design Head issues the transmittal.
5. Recipient acknowledges receipt.

Flow: `Draft → Issued → Acknowledged`.

The issued transmittal remains frozen even if a newer revision is released later. Production, SCM, Quality and customers should act from the transmittal—not an uncontrolled local attachment.

## Engineering changes after release

Never directly edit a released design. Raise an Engineering Change.

`Draft → Impact Assessment → Pending Approval → Approved → Implementing → Closed`

### Change preparation and assessment

1. Record classification, priority, reason, proposed solution, coordinator and target date.
2. Identify every affected drawing/revision, BOM, item, inventory balance, WIP, purchase order, sales order and other record.
3. Assess Design, BOM, Inventory, WIP, Procurement, Production, Quality, Cost, Schedule and Customer impact.
4. Define inventory/WIP disposition: use as-is, rework, scrap, return to vendor, hold or not applicable.
5. Define effectivity: immediate, next production run, date, serial number or lot number.
6. Assign downstream acknowledgement owners.

Submission is blocked until an affected record exists, every impact area is assessed, every affected record has a disposition and at least one acknowledgement owner is assigned.

### Approval, implementation and closure

The Design Head approves or rejects with maker-checker protection and cannot approve a change they requested. After approval, implement new revisions and operational actions. Closure requires all acknowledgements and an implementation summary.

Generate a controlled Change Report where internal or customer signatures are required. Report revisions preserve frozen payloads and previous signatures.

## Cross-module hand-offs

| From Design Engineering | Receiving module | Handoff evidence |
|---|---|---|
| Quote BOM hand-over | Sales / SCM | Intake status, BOM revision and linked design request. |
| Released BOM/drawings | SCM RFQ | Live BOM view and authorised technical attachments. |
| Released documents | Production / Quality | Design Head release and acknowledged transmittal. |
| Customer-approved revision | Sales / Project | Approval reference and evidence on the exact revision. |
| Engineering change | Inventory / WIP / SCM / Production / Quality | Impact, disposition, effectivity and named acknowledgements. |
| NCR/CAPA design request | QMS | Linked source request, project output and controlled revision/change. |

## Operating controls and exceptions

| Situation | Required action |
|---|---|
| Sales has a complete customer parts list | Use the transcription/matching intake route; do not raise unnecessary design work. |
| Customer supplied only a requirement | Use Create Product & send to design team; SCM cannot source a BOM that does not exist. |
| Brief is too short or ambiguous | Design rejects/returns for clarification; do not guess critical requirements. |
| Component appears to exist | Search and verify Item Master before creating a duplicate. |
| Revision is prepared but cannot be released | Check independent checker, customer approval, project requirements, milestones, reviews and open changes. |
| Design Head option is unavailable | Super Admin must designate the sole active Design Head; admin access alone is not release authority. |
| Customer asks for a change after approval | Create a new controlled revision and repeat required checking/approval. |
| Released design must change | Raise an Engineering Change; never overwrite the released revision. |
| Production has an emailed drawing not in a transmittal | Stop and obtain the acknowledged controlled transmittal/revision. |
| Old stock or WIP is affected | Record disposition and effectivity before approving the change. |

## Release checklist

- [ ] Request scope and source links are complete.
- [ ] Project lead and target date are assigned.
- [ ] Mandatory requirements have acceptance criteria and verification evidence.
- [ ] Milestones and deliverables are complete or formally cancelled.
- [ ] Every controlled document is pinned to the correct Vault file version.
- [ ] A different qualified person completed the independent check.
- [ ] Required customer approval is attached to the exact revision.
- [ ] Formal design-review minutes, decision and actions are closed.
- [ ] No engineering change remains open.
- [ ] Design Head—not merely an administrator—performed release.
- [ ] Released documents were issued through a controlled transmittal.
- [ ] Production/SCM/Quality acknowledgement is recorded where required.

## Record-retention rules

- Never delete or overwrite released revisions to “clean up” history.
- Keep rejected revisions, superseded documents, review decisions and change reasons traceable.
- Treat customer drawings, product designs, BOMs and calculations as confidential intellectual property.
- Use Vault permissions and versioning rather than uncontrolled shared-drive copies.
- Use the ERP links between opportunity/order, product, project, BOM, document, RFQ and change so the audit trail remains end to end.
