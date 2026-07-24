# PhazeOne — Phaze ERP: Standard Operating Procedures

**Purpose of this document:** A click-by-click reference for employee training, extracted directly from the live codebase (routes, components, field labels, button text, and access-control code) as of 2026-07-23 — not from historical spec documents. Several modules changed after their original spec was written, so **wherever this document's findings differ from a prior spec doc, that is flagged explicitly** in a "Discrepancies / uncertainties found" subsection at the end of each part. Treat those flags as the most important content in this document, not footnotes.

**How to read the access-control notes:** Every module in this system is gated at two layers — a coarse `@Roles()` decorator on the backend controller (usually just "any authenticated non-admin-only role"), and a fine-grained assertion inside a dedicated access-service (the real gate). Where the two layers diverge — i.e. a UI button is visible to more people than the backend will actually allow to click it — this is called out explicitly per section. Do not assume a visible button means the action will succeed.

**Two independent authorization mechanisms exist side by side and are easy to conflate:**
1. **Boolean designation flags** on `Employee` (e.g. `isSalesHead`, `isQcInspector`) — a capability layered on top of a person's `Role`, granted individually by an Admin/SuperAdmin. See Appendix A.
2. **Vertical membership** (`Employee.verticalId` → which department/vertical someone belongs to) — a completely separate mechanism that gates whole nav groups and "manager of my own department" actions. See the note at the top of Appendix A.

---

## Table of Contents

1. [Sales](#1-sales)
2. [R&D / Design (Item Master & BOM)](#2-rd--design-item-master--bom)
3. [SCM / Procurement](#3-scm--procurement)
4. [Production / Stores](#4-production--stores)
5. [Quality — QC Inspector Role](#5-quality--qc-inspector-role)
6. [Logistics](#6-logistics)
7. [Accounts / Finance](#7-accounts--finance)
8. [HR](#8-hr)
9. [Cross-Cutting Features](#9-cross-cutting-features)
10. [PLM (Product Lifecycle Management)](#10-plm-product-lifecycle-management)
- [Appendix A — Designation & Approval-Authority Reference](#appendix-a--designation--approval-authority-reference)
- [Appendix B — Document Numbering Reference](#appendix-b--document-numbering-reference)
- [Master Discrepancy Log](#master-discrepancy-log)

---

## 1. Sales

The Sales module covers the pipeline from a raw enquiry through to a signed, in-production order: **Leads → Opportunities → Bid/No-Bid Assessment → Bids (with discount approval) → Orders → Order Confirmation Sheet signing**. All screens live under `web/app/(protected)/sales/**`; all backend logic lives under `src/modules/sales/**`.

### Module-wide access rules (read this first)

Every Sales screen is gated by two layers, verified in code:

1. **Route gate** — `web/app/(protected)/sales/layout.tsx` redirects away unless the user is `SUPER_ADMIN` or Sales-vertical staff (`useIsSalesStaff`). Plain `ADMIN` is explicitly **excluded** — Admin is account-management-only in this system, mirroring the same rule in the Employee module.
2. **Service gate** — every controller declares a broad `@Roles(MANAGER, EMPLOYEE, SUPER_ADMIN)` decorator, but the real gate is `SalesAccessService.assertSalesAccess()` (`src/modules/sales/common/sales-access.service.ts`), which additionally requires the caller's `vertical.code === 'SALES'` (unless SUPER_ADMIN).
   - **Reads are vertical-wide**: any Sales-vertical EMPLOYEE/MANAGER can view *all* Leads/Opportunities/Bids/Orders — no per-owner filtering on GETs.
   - **Writes are owner/hierarchy-scoped**: `assertCanAccessOwned()` restricts mutations (edit, submit, convert, status change) to the record's own owner, or — for a MANAGER — the owner plus their downstream team (`EmployeesService.getTeam`). SUPER_ADMIN is unrestricted.

Nav path (sidebar), from `web/app/lib/nav.ts` (`salesNav()`), heading **"Pipeline"**: Leads → Opportunities → Bids → Orders → (conditionally) Bid Approvals → (conditionally) Assessment Approvals → (conditionally) Confirmation Sheets. Heading **"Master Data"**: Customer Master.

---

### 1.1 Leads

**Nav path:** Pipeline → **Leads** (`/sales/leads`)

**Purpose:** Capture and qualify raw enquiries before they become a formal Opportunity.

**Fields/inputs** (dialog titled "New Enquiry" / "Edit Enquiry", from `web/app/(protected)/sales/leads/page.tsx`):
- `Company name` (required)
- `Contact name` (required)
- `Email`
- `Phone`
- `Requirement` (required, textarea, placeholder "e.g. Liquid Cooling LC25 — 500 nos")
- `Business unit` (required select, with a "*" marker and a `BusinessUnitHelp` tooltip)
- `Priority` (select: HIGH / MEDIUM / LOW, default MEDIUM)
- `Source` (select: REFERRAL / WEBSITE / COLD_OUTREACH / EVENT / OTHER, default OTHER)

**Actions/buttons:**
- **"+ New Enquiry"** (page header) → opens the create dialog → `POST /leads`. Server auto-generates a `leadNumber` via `SalesNumberingService.nextNumber('LD', 'lead', year, tx)`, i.e. format **`LD-2026-0001`**.
- **"Edit"** row action (owner, or MANAGER/ADMIN/SUPER_ADMIN, and only while not yet CONVERTED) → `PATCH /leads/:id`. Backend blocks editing a CONVERTED lead and blocks setting status to CONVERTED via this endpoint (must use `/convert`).
- **"Qualify"** (shown when `status === 'NEW'`) → `PATCH /leads/:id` with `{status: 'QUALIFIED'}`.
- **"Follow-up"** (shown when `status === 'CONTACTED'`) → navigates to the lead detail page; no status change fired from the list.
- **"Convert to Opportunity"** (shown when `status === 'QUALIFIED'`) → opens the "Convert … → Opportunity" dialog: fields `Opportunity name` (required), `Estimated value (₹)` (required), `Expected close date` (required, can't be past), `Billing address (line)`, `Billing state (drives GST intra/inter-state)`. Submits `POST /leads/:id/convert`. Creates a `Customer` (with a primary `CustomerContact`) if none linked, creates the `Opportunity`, and marks the Lead `CONVERTED`.
- **"View Opportunity"** (shown once CONVERTED) → routes to `/sales/opportunities/:id`.

**Lead detail page** (`/sales/leads/:id`): read-only summary (Requirement, Business unit, Owner, Priority, Source, Email, Phone) plus an **Attachments** panel — **"Attach file"** button (owner/MANAGER/ADMIN/SUPER_ADMIN only) links a Vault file via `POST /leads/:id/attachments` into the vertical-scoped "Lead Attachments" DEFAULT Vault folder; each row has **"View"** (opens the in-app preview) and a delete icon (`DELETE /leads/:id/attachments/:attachmentId`), 25MB max per file.

**Who can do this:** Controller `@Roles(MANAGER, EMPLOYEE, SUPER_ADMIN)`; real gate is `SalesAccessService.assertSalesAccess` (SALES-vertical staff or SUPER_ADMIN). Create/update/convert/attach additionally require `assertCanAccessOwned` (self or, for a manager, downstream team). Assigning a lead to a different owner (`ownerId` in the create DTO) is further restricted to MANAGER/SUPER_ADMIN (`resolveOwnerId` in `leads.service.ts`).

**What happens next:** A converted Lead produces an `Opportunity`; the Opportunity detail page is where the Bid/No-Bid gate lives — the Lead Register deliberately does not predict that state.

---

### 1.2 Opportunities

**Nav path:** Pipeline → **Opportunities** (`/sales/opportunities`); detail at `/sales/opportunities/:id`

**Purpose:** Track a qualified deal through its stages and gate whether a Bid may be created against it.

**Fields/inputs (list page):** search (company/name/owner), Stage filter (PROSPECTING / QUALIFICATION / PROPOSAL / NEGOTIATION / CLOSED_WON / CLOSED_LOST), Business unit filter. Summary cards: "Active Opportunities", "Pipeline Value", "Proposals", "Closing This Month".

**Fields/inputs (detail page — "Update stage" card):**
- `Stage` select (same 6 enum values)
- `Reason for loss` (textarea, required only when Stage = CLOSED_LOST; the frontend blocks save client-side with "A lost reason is required when closing as lost")

**Actions/buttons:**
- **"Save stage"** → `PATCH /opportunities/:id` with `{stage, lostReason?}`.
- **"Submit Bid/No-Bid Assessment"** / **"Resubmit Assessment"** (button label driven by `deriveBidGate()` in `web/app/lib/bid-assessment.ts`) → opens the `BidAssessmentDialog`.
- **"Create Bid"** (only rendered when `gate.canCreateBid` is true, i.e. the latest assessment is APPROVED) → routes to `/sales/bids/new?opportunityId=...`.

**Bid/No-Bid gate states** (badge + action, computed client-side from `GET /opportunities/:id/bid-assessments`, most-recent-first):

| Latest assessment | Badge | Action shown |
|---|---|---|
| none | — | "Submit Bid/No-Bid Assessment" |
| PENDING_REVIEW | "Assessment pending review" (info) | none |
| REJECTED | "Assessment rejected" (destructive) + reviewer comments shown inline | "Resubmit Assessment" |
| APPROVED | "Assessment approved ✓" (success) + reviewer's e-signature shown | "Create Bid" enabled |

**Who can do this:** Same `SalesAccessService` gate as Leads. Stage edits are owner/team-scoped writes; reads are vertical-wide.

**What happens next:** Approving the assessment is what unlocks Bid creation on this Opportunity (enforced server-side in `BidsService.create`, not just hidden in the UI).

---

### 1.3 Bids — including the Bid/No-Bid assessment gate

#### 1.3a Bid/No-Bid Assessment (the formal gate)

**Where triggered:** From the Opportunity detail page, `BidAssessmentDialog` (`web/app/(protected)/sales/_components/bid-assessment-dialog.tsx`), titled **"Bid/No-Bid Assessment"**.

**Fields/inputs:** One field per **active** `BidAssessmentQuestion` (admin-configured, `GET /bid-assessment-questions`), rendered by `q.type`:
- `TEXT` → Textarea
- `BOOLEAN` → Select with options "Yes"/"No" (`true`/`false`)
- `SCALE` → Select 1–5 (`SCALE_OPTIONS`)
- `SELECT` → Select populated from the question's `options` JSON

Every question is rendered `required`; leaving one blank shows "This question is required" per-field. If zero active questions are configured, the dialog shows: "No active assessment questions are configured. Ask an Admin to add some."

**Actions/buttons:**
- **"Submit for review"** → confirm dialog ("This will be sent to the Sales Head. You cannot edit it after submitting.") → `POST /opportunities/:id/bid-assessment`. Backend (`BidAssessmentsService.submit`) snapshots each question's current text, blocks submission if a PENDING_REVIEW assessment already exists for that Opportunity, and requires every active question answered.
- **"Cancel"** → closes without submitting.

**Reviewer screen — Assessment Approvals queue** (`/sales/bid-assessments/pending-approval`, nav item **"Assessment Approvals"**):
- List of PENDING_REVIEW assessments, showing Opportunity name + Submitted date.
- **"Review assessment"** / **"Review →"** opens a dialog showing each question + snapshotted answer, plus a `Reviewer comments` textarea (hint: "Required to reject; optional to approve.").
- **"Approve"** → `PATCH /bid-assessments/:id/approve`. Snapshots the reviewer's e-signature.
- **"Reject"** → `PATCH /bid-assessments/:id/reject`; comments are mandatory (blocked client-side and server-side if blank).

**Who can do this — verified two-layer gate:**
- Controller `@Roles(MANAGER, EMPLOYEE, SUPER_ADMIN)` on `BidAssessmentsController`.
- **Submit**: `SalesAccessService.assertCanAccessOwned` (opportunity owner, or their manager/team, or SUPER_ADMIN).
- **Review (approve/reject/pending-approval queue)**: `BidAssessmentsService.assertCanReview()` — **only the employee with `Employee.isSalesHead = true`, or SUPER_ADMIN**. This is a boolean designation flag (not a `Role`), set via `PATCH /employees/:id/designate-sales-head` (Admin/SuperAdmin only), which atomically unsets any previous holder — **exactly one active Sales Head at a time**. If no Sales Head is designated, SUPER_ADMIN is the sole fallback reviewer, so the process is never fully blocked.
- The nav item "Assessment Approvals" is itself gated by `access.isSalesHead || isSuperAdmin`.

**What happens next:** `BidsService.create` calls `bidAssessments.latestApprovedFor(opportunityId)` — only if the **most recent** assessment for that Opportunity is `APPROVED` can a Bid be created (`POST /bids` throws 400 otherwise). A later PENDING/REJECTED submission supersedes an older APPROVED one.

#### 1.3b Bids

**Nav path:** Pipeline → **Bids** (`/sales/bids`); create at `/sales/bids/new`; detail at `/sales/bids/:id`; approval queue at `/sales/bids/pending-approval` (nav label **"Bid Approvals"**).

**Purpose:** Draft, price, and route a formal commercial proposal for an approved Opportunity.

**Fields/inputs (New Bid page — plain HTML labels, not the shared `<Field>` component):**
- "Opportunity" (select, required)
- "Valid until" (date, required, can't be in the past)
- "Tender reference number (optional)"
- "Quotation subject (optional)"
- "Technical specification" (textarea; internal only, not printed on the proposal)
- "Reference link (metadata only — no file upload in this phase)" — "File name" and "https://…"
- Line items table: Product (select, filtered to the opportunity's business unit), Unit price (read-only), Qty, "Line disc %", Line total (computed)
- "+ Add line" button
- "Bid-level discount %" (number input, 0–100)
- Live totals box: Subtotal / Discount / Taxable (tax computed server-side)

**Actions/buttons:**
- **"Create Bid (Draft)"** → confirm ("Create this bid?") → `POST /bids`. Server snapshots each line's `Product.unitPrice`, validates all products share the Opportunity's business unit, resolves tax (CGST_SGST if the customer's billing state = "Karnataka", else IGST), and generates a bid number **`BID-2026-0001`**.
- **"Cancel"** → `router.back()`.
- On the New Bid form, a warning banner appears when `discountPercent > 10`: "⚠ This bid's discount exceeds 10% — it will require manager approval before it can be sent."

**Bid detail page actions**, gated by current `status`:
- **"Submit"** (DRAFT or REJECTED) → `PATCH /bids/:id/submit`. If `discountPercent > 10`, moves to `PENDING_APPROVAL`; otherwise goes straight to `SENT`.
- **"Approve"** / **"Reject"** (shown only to the resolved approver or an Admin/SuperAdmin, while `PENDING_APPROVAL`) → optional `approverComments`. Approve snapshots the approver's e-signature.
- **"Mark as Sent"** (APPROVED) → `PATCH /bids/:id/status {status: 'SENT'}`.
- **"Mark as Accepted"** (SENT) → `PATCH /bids/:id/status {status: 'ACCEPTED'}`.
- **"Convert to Order"** (ACCEPTED, not yet converted) → `POST /bids/:id/convert-to-order`.
- **"View Order"** (ACCEPTED, already converted).
- **"New revised bid"** (DRAFT or REJECTED) → routes to `/sales/bids/new?opportunityId=...`.
- **"Download PDF"** → client-side browser print of the "Techno Commercial Proposal".

**Bid Approvals queue (`/sales/bids/pending-approval`):** PENDING_APPROVAL bids with an inline "Optional approval comment" input and **"Approve"**/**"Reject"** buttons.

#### 1.3c Discount approval mechanism

- **Threshold:** hardcoded `DISCOUNT_APPROVAL_THRESHOLD = 10` (%) in `src/modules/sales/bids.service.ts`. A bid whose `discountPercent > 10` cannot go straight to SENT on submit.
- **Routing service:** `ApprovalRoutingService` — reused from the leave-request approval pattern. `resolveApprover(createdById)` walks to the bid creator's `reportingManagerId`; if a manager submits their own bid, it escalates one level further up (never to self). Self-approval is always blocked, and Admin/SuperAdmin can always act.
- If the resolved approver is null (creator has no reporting manager), submit throws an error naming the gap.
- **Who can approve:** the specific resolved approver (the creator's manager) OR any `ADMIN`/`SUPER_ADMIN`.
- Note: this is a **per-bid-header discount** gate (`Bid.discountPercent`), separate from optional per-line `lineDiscountPercent`, which has no approval gate of its own. There is **no separate Order-level discount approval** — Orders carry a frozen `totalAmount` snapshot from the accepted Bid and have no discount field of their own.

**Who can do this (Bids overall):** Controller `@Roles(MANAGER, EMPLOYEE, SUPER_ADMIN)`; create/submit/markStatus require `assertCanAccessOwned`; approve/reject require `ApprovalRoutingService.assertCanActOnBid`.

**What happens next:** An ACCEPTED bid converts to a CONFIRMED Order, copying line items and snapshotting `totalAmount`.

---

### 1.4 Orders

**Nav path:** Pipeline → **Orders** (`/sales/orders`); detail at `/sales/orders/:id`

**Purpose:** Track a confirmed sale from CONFIRMED through production to delivery. Orders are **never created directly** — only via "Convert to Order" on an ACCEPTED Bid.

**Fields/inputs (list page):** search (order #/owner), Status filter (CONFIRMED / IN_PRODUCTION / READY_TO_SHIP / SHIPPED / DELIVERED / CANCELLED), Business unit filter. Summary cards: "Confirmed", "In Production", "Ready / Shipping", "Booked Value".

**Detail page sections:** header, `ProcessFlow` progress strip, metadata (Total, Owner, "View bid" link), Line items table, "Update status" card, then the **Order Confirmation Sheets** section, Project Kickoff section, and PLM section.

**Actions/buttons:**
- **"Update"** (status select + button) → `PATCH /orders/:id/status`. Legal forward transitions: CONFIRMED→{IN_PRODUCTION, CANCELLED}; IN_PRODUCTION→{READY_TO_SHIP, CANCELLED}; READY_TO_SHIP→{SHIPPED, CANCELLED}; SHIPPED→{DELIVERED, CANCELLED}; DELIVERED/CANCELLED are terminal.
- **Hard gate:** moving CONFIRMED→IN_PRODUCTION is blocked server-side unless the order's latest `OrderConfirmationSheet` is `EXECUTED`.

**Who can do this:** Controller `@Roles(MANAGER, EMPLOYEE, SUPER_ADMIN)`; `SalesAccessService.assertSalesAccess` + `assertCanAccessOwned` for the status-update write; reads are vertical-wide.

**Order numbering:** **`ORD-2026-0001`**, allocated inside the same transaction as `convertFromBid`.

---

### 1.5 Order Confirmation Sheet signing

**Where:** Embedded directly on the Order detail page as the **"Order Confirmation Sheets"** card — there is no separate route for editing a sheet; the reviewer queue at `/sales/confirmation-sheets/pending-approval` (nav label **"Confirmation Sheets"**) is a discovery surface only.

**Purpose:** A formal, customer-agreed requirements document that must be customer-signed and then Sales-Head-countersigned before a CONFIRMED order can enter production. This is an **internal-countersignature flow with an offline customer wet-signature step**, NOT a public token-based e-sign link — the customer never gets a portal URL; the rep downloads a PDF, gets it physically signed, and uploads the scan.

**Lifecycle:** `DRAFT` → `AWAITING_CUSTOMER_SIGNATURE` → `AWAITING_INTERNAL_SIGNATURE` → `EXECUTED` (or `REJECTED` at the internal-signature step).

**Fields/inputs (editable only while DRAFT):** Requirements overview, Delivery date/type, Delivery location, Packaging type/compliance standard, Protective measures, Labeling requirements, Customer packaging spec reference, Quality reports expected (checkboxes) + notes, Installation & commissioning (switch) + notes, Warranty terms, Payment milestones, Site readiness requirements, Special handling instructions, Contact name/phone/email.

**Actions/buttons, by status:**
- **"Create Confirmation Sheet"** → `POST /orders/:orderId/confirmation-sheets`. Only for a `CONFIRMED` order. Generates confirmation number **`OC-2026-0001`**.
- **"Save"** (DRAFT).
- **"Generate PDF"** (DRAFT) → locks the sheet, moves to `AWAITING_CUSTOMER_SIGNATURE`. Server enforces every required field is filled first.
- **"Download PDF"** (AWAITING_CUSTOMER_SIGNATURE).
- **"Upload signed copy"** (AWAITING_CUSTOMER_SIGNATURE) → presigned R2 upload → moves to `AWAITING_INTERNAL_SIGNATURE`.
- **"Request Revision"** → creates a new DRAFT revision, preserving history.
- **"Countersign"** (AWAITING_INTERNAL_SIGNATURE, reviewer only) → moves to `EXECUTED`, snapshots the signer's e-signature.
- **"Reject"** (AWAITING_INTERNAL_SIGNATURE, reviewer only) → requires `Comments`.

**Who can do this — verified two-layer gate:**
- Controller `@Roles(MANAGER, EMPLOYEE, SUPER_ADMIN)`.
- **Create/edit/generate-pdf/upload/request-revision**: `assertCanAccessOwned` against the **order's** owner.
- **Sign / Reject / pending-approval queue**: only `Employee.isSalesHead = true`, or SUPER_ADMIN — the same single-holder flag and routing pattern as the Bid/No-Bid review.

**What happens next:** An `EXECUTED` sheet is the hard gate that unblocks the Order's `CONFIRMED → IN_PRODUCTION` transition. It also feeds the Project Kickoff section on the same order page.

### Discrepancies / uncertainties found — Sales

1. No root-level Sales spec doc exists in the repo to diff against — content above was extracted purely from current code.
2. "Discount approval" — confirmed there is only a bid-level mechanism; no separate Order-level discount approval exists.
3. Order Confirmation Sheet signing is **not** token-based/public, unlike other public flows in this app — it's internal countersignature + offline customer wet-signature.
4. Sales Head is a boolean `Employee` flag, not a `Role`; gates both the Bid/No-Bid review queue and the Order Confirmation Sheet countersignature queue identically, with SUPER_ADMIN as a standing fallback.
5. Bid-detail "Submit" and "Bid Approvals" pages use plain inline styles, not the shared design-system components used elsewhere — a UI-consistency gap, not functional.
6. Numbering prefixes confirmed exactly as coded: `LD-YYYY-####`, `BID-YYYY-####`, `ORD-YYYY-####`, `OC-YYYY-####` — all 4-digit zero-padded, year-scoped, reset annually.
7. The 10% bid-discount approval threshold is a hardcoded constant, not admin-configurable anywhere in the UI.

---

## 2. R&D / Design (Item Master & BOM)

### Module-wide access rules

- `bom-access.service.ts` gates: `assertCanReadItems` (R&D/Store/SUPER_ADMIN), `assertCanManageItems` (**R&D Head or SUPER_ADMIN only**), `assertCanAuthorBoms` (R&D vertical or SUPER_ADMIN), `assertCanApproveBoms` (**real `isRdHead` holder ONLY — SUPER_ADMIN explicitly NOT sufficient**, no bypass exists).
- Nav (`web/app/lib/nav.ts`, Engineering group, gated `isRndStaff || isSuperAdmin`): Products (`/sales/products`), Bills of Materials (`/scm/bom`), BOM Approvals (`/scm/bom/pending-approval`, only if `isRndHead`). Item Master itself lives under the separate "Store Management" nav group.

### 2.1 Item Master

**Nav path:** Store Management → Item Master (`/scm/items`)

**Purpose:** Central catalog of Raw Material / Component / Subassembly / Finished Good / Consumable items.

**Fields/inputs (New/Edit Item dialog):** Name, Type (select), Item code (read-only, auto-generated, hidden in edit mode), Base unit of measure, Default wastage %, Standard lead time (days), Drawing / spec reference, Description. Also an `ItemSuppliers` subsection (Add supplier / Part number / Add / Unlink) — purely informational, no effect on BOM release.

**Actions/buttons:** "+ New Item" (shown to SUPER_ADMIN/ADMIN/MANAGER in the UI — **looser than the real backend gate**, see discrepancy #3), Edit, Deactivate.

**Item code format:** `{PREFIX}-{5-digit zero-padded sequence}`, e.g. `RM-00001`. Prefix map: RAW_MATERIAL→RM, COMPONENT→CM, SUBASSEMBLY→SA, FINISHED_GOOD→FG, CONSUMABLE→CN. Continuous sequence, never resets, backed by a sentinel "year 0" row per entity. `GET /items/next-code?itemType=...` is a non-consuming preview only.

**Who can do this:** Real gate is `isRdHead` or SUPER_ADMIN only (`assertCanManageItems`) — confirmed `useIsRndHead` hook explicitly does NOT auto-treat SUPER_ADMIN as R&D Head (unlike other capability hooks), but the backend does allow SUPER_ADMIN as an override for item management specifically.

### 2.2 BOM (Bill of Materials) creation and approval

**Nav path:** Engineering → Bills of Materials (`/scm/bom`); create at `/scm/bom/new`; detail at `/scm/bom/[id]`; edit at `/scm/bom/[id]/edit`; approval queue at `/scm/bom/pending-approval`.

**Fields/inputs (New BOM):** Item, Effective date, Revision notes, plus per-line fields (Item, Qty/unit, UoM, Wastage %, Make/Buy, Notes) via the shared `BomLineEditor`.

**BomStatus enum:** `DRAFT, PENDING_APPROVAL, REJECTED, RELEASED, OBSOLETE`.

**Actions/buttons (BOM detail, state-machine-driven):**
- **Edit / Submit for Approval** — while DRAFT or REJECTED.
- **Approve / Reject** — while PENDING_APPROVAL, only shown to a non-creator R&D Head.
- **Create New Revision** — once RELEASED.

**Maker-checker (confirmed in `bom.service.ts` `approve()`):** `if (bom.createdById === user.id) throw new ForbiddenException('An R&D Head cannot approve a BOM they created — another R&D Head must approve it')`.

**Release gate:** ONLY `assertNoReleaseCycle()` (a multi-level BOM-explosion cycle/depth check) — **the previously-documented qualified-supplier hard-gate has been confirmed removed**; supplier links on an Item are purely informational. This matches the current wording of `BOM_INVENTORY.md` at the repo root, which is *not* stale on this point.

**Rejection** requires a non-empty `comment` (400 otherwise). On approval, any other RELEASED revision of the same item is auto-flipped to `OBSOLETE` in the same transaction.

**Who can do this:** `assertCanAuthorBoms` (R&D vertical or SUPER_ADMIN) to create/submit; `assertCanApproveBoms` (real `isRdHead` holder ONLY, no SUPER_ADMIN bypass) to approve/reject.

**BOM Approvals queue** (`/scm/bom/pending-approval`): restricted view, only meaningfully populated/actionable for non-creator R&D Heads.

### Discrepancies / uncertainties found — R&D / Design

1. **Confirmed, not stale**: the qualified-supplier BOM-release gate really was removed, and `BOM_INVENTORY.md` already accurately reflects this — a rare case where the root-level spec doc is *current*, not outdated.
2. Auto-item-code feature (`{PREFIX}-{5-digit}` continuous sequence) matches the doc exactly.
3. **UI/backend role-gate mismatch**: the Item Master/BOM management buttons render for SUPER_ADMIN/ADMIN/MANAGER in the UI, but the real backend gate requires a genuine `isRdHead` holder (or SUPER_ADMIN specifically for Item Master, but NOT for BOM approval). A plain Manager will see the button and get a 403 on click.
4. `BomStatus` enum matches the doc exactly: `DRAFT, PENDING_APPROVAL, REJECTED, RELEASED, OBSOLETE`.
5. Confirmed SUPER_ADMIN cannot approve a BOM under any circumstance — only a real `isRdHead` holder can, by design.
6. A stale inline code comment exists on `LinkSupplierDto` still referencing a "release hard-gate" even though no such gate exists in the actual logic — a minor doc leftover in the code itself, not a real behavior.

---

## 3. SCM / Procurement

The SCM nav group (heading **`SCM`**) is shown only when `isScmStaff || isSuperAdmin`, containing exactly:

| Label | Href |
|---|---|
| Vendors | `/scm/vendors` |
| Suppliers | `/scm/suppliers` |
| RFQs | `/scm/rfqs` |
| Purchase Orders | `/stores/purchase-orders` |

The last item's href is deliberately under `/stores/` even though grouped under SCM in the nav. Reads across all four are company-wide for any authenticated employee; the nav group itself is hidden from non-SCM-vertical, non-SUPER_ADMIN users.

### 3.1 Vendor Qualification

**Nav path:** SCM → Vendors (`/scm/vendors`); detail at `/scm/vendors/[id]`

**Purpose:** Onboard and qualify vendors (outsourced manufacturing) through a self-assessment questionnaire and internal audit.

**New Vendor dialog fields (exactly two, both required):** `Company name`, `Contact email`. Helper text: *"The vendor will fill in company details, contact person, and the rest of the profile themselves via the questionnaire."*

**Vendor Detail page sections:**
- **"Company Information"** — read-only, blank until the vendor completes their questionnaire.
- **"Questionnaire"** — revision table; **Invite generation** (manager + latest questionnaire `SENT`): optional password, **"Generate Invite Link"** → `<origin>/public/vendor-questionnaire/<token>`, **Copy**, **Revoke**. Default expiry 336 hours (14 days). **"Create New Revision"** button resets to `PENDING_QUESTIONNAIRE` and copies forward prior answers.
- **"Audits"** — **"Create Audit"** button (once questionnaire `SUBMITTED`).

**Public Vendor Questionnaire** (`/public/vendor-questionnaire/[token]`, unauthenticated): Section 1 "Company Information" (Registered Address, Factory Address, Year Established, Number of Employees, Annual Turnover, MSME/UDYAM Certificate, Contact Person Name/Designation, Contact Phone, Website — `Company name`/`Contact email` are fixed and not editable here); Sections 2–19 cover 18 JSON-backed capability sections. **"Save Progress"** (resumable) / **"Submit"** (blocked until Declaration checkbox ticked). Locked once submitted.

**Internal Audit + Classification (Vendor):** dialog **"Create Audit"** — Audit type (Physical/Virtual), Audit date, 10-category scoring table (Manufacturing Capability 20, Capacity 10, Quality System 20, Engineering 10, Financial Stability 5, Supply Chain 10, Export Readiness 10, Sustainability 5, EHS 5, Customer References 5 = 100), Audit notes. **"Finalize Audit"** — every category must be scored.

**Classification thresholds:** 90–100 → Approved (Preferred Vendor); 80–89 → Approved; 70–79 → Conditionally Approved (Improvement Plan Required); <70 → Not Approved. `totalScore`/classification are never stored — computed live on every read. Create = finalize; no draft audit state.

**Who can do this:** Create/manage vendor (`assertCanManageVendors`) — SUPER_ADMIN OR (MANAGER role AND SCM vertical); plain ADMIN excluded. **Audit** (`assertCanAudit`) — `Employee.isInternalAuditor === true` (boolean flag, independent of Role, multiple holders allowed) OR SUPER_ADMIN.

**No document numbering exists for Vendor records** — UUID `id` only.

### 3.2 Supplier Qualification

Mirrors Vendor almost exactly (record → questionnaire revisions → token invite → internal audit → classification → status), same access-service logic (same `isInternalAuditor` flag audits both), same "only companyName + contactEmail required" creation rule, same 90/80/70 thresholds.

**Supplier-only addition — "Fill internally":** on the Supplier detail page (manager + latest questionnaire `SENT`), lets SCM staff complete the questionnaire on the supplier's behalf (e.g. after a phone call) using the exact same form component the supplier would see. Every field is optional in this internal-fill mode (no Declaration-checkbox gate). **"Save Progress"** / **"Mark as Submitted"**. Sets `filledBy: INTERNAL_STAFF` vs. `EXTERNAL_SUPPLIER` for the public path — shown in a **Source** column on the questionnaire table.

**Public Supplier Questionnaire sections (2–10, fewer than Vendor's 18):** Material Range, Material Certifications, Compliance (RoHS/REACH/Conflict Minerals), Quality Certifications, Commercial Terms, Packaging & Delivery (marked Optional), Logistics, References, Declaration.

**Internal Audit + Classification (Supplier):** 6 categories, not 10: Material Certifications & Quality (30), Compliance (15), Commercial Terms (20), Logistics & Delivery (15), Financial Stability (10), References (10). Same 90/80/70 thresholds and same `isInternalAuditor` flag — no separate "Supplier Auditor" designation.

**No document numbering exists for Supplier records** either.

### 3.3 RFQ (Request for Quote) — invitee minimum, sealed bids, award

**Nav path:** SCM → RFQs (`/scm/rfqs`); create at `/scm/rfqs/new`; detail at `/scm/rfqs/[id]`; compare/award at `/scm/rfqs/[id]/compare`

**Purpose:** Sealed-bid sourcing to suppliers and vendors.

**RFQ Creation fields:** Title (required), Description, Submission Deadline (required), Required By Date, Delivery Location, Payment Terms Requested, repeatable Line Items. **Invitees are NOT selected at creation** — added afterward, one at a time, on the detail page while DRAFT. **"Create RFQ"** → status `DRAFT`. Numbering: **`RFQ-YYYY-####`**.

**Minimum invitee count — confirmed exactly 3**, hardcoded identically in both backend (`rfq.service.ts`, `const MIN_INVITEES = 3`) and frontend, enforced **only at issue time** via a plain `if` check inside `issue()` — **not** a DTO validator, and **not** checked at RFQ creation time.

**RFQ Detail page — header actions (status-gated):**
- **"Issue RFQ"** — DRAFT only, disabled until ≥3 active invitees.
- **"Close early"** — ISSUED only.
- **"Compare & Award"** — once CLOSED.
- **"Cancel"** (destructive) — DRAFT or ISSUED only.

**Add invitee mini-form** (managers, DRAFT only): radio Supplier/Vendor, partner select (warns `⚠` if unqualified — non-blocking), optional link password, **"Add"**.

**Sealed-bid submission** (`/public/rfq-quote/[token]`, unauthenticated): per-line Unit Price/Lead Time/Remarks, Quote Terms, Decline option. **"Save Draft"** / **"Submit Quote"** / **"Decline to Quote"**. Confirmed sealed: the invitee endpoint only ever returns that invitee's own row, never other bids. Locked once `SUBMITTED`.

**Bid Comparison + Award** (`/scm/rfqs/[id]/compare`): adjustable scoring weights (Price/Lead Time/Qualification, default 60/20/20, advisory only). Per-invitee **"Award"** button (only for `SUBMITTED` quotes). Award dialog requires a **Justification** if not the lowest total. **"Confirm Award"**.

**Award backend logic:** requires RFQ `CLOSED`; auto-creates a **DRAFT Purchase Order** via the same `PurchaseOrderService.create()` used for manual POs, with `notes: "Auto-drafted from awarded RFQ {rfqNumber}"` as the only trace of origin — **no foreign key links the PO back to the RFQ**. Sets RFQ `status: AWARDED`. **No notification/email is sent** to winning or losing invitees — manual, out-of-band.

**Who can manage an RFQ:** `assertCanManageRfqs` — SUPER_ADMIN OR (MANAGER role AND SCM vertical). **Who can award — a narrower, DIFFERENT gate:** `assertCanAward` — SUPER_ADMIN OR `Employee.isProjectManager === true`. An SCM Manager who is not also flagged Project Manager can run the whole RFQ process but cannot click Award.

**RFQ status enum:** `DRAFT → ISSUED → CLOSED → AWARDED`, with `CANCELLED` reachable from DRAFT/ISSUED only.

### 3.4 Purchase Orders

**Nav path:** SCM → Purchase Orders (`/stores/purchase-orders`); create at `/stores/purchase-orders/new`; detail at `/stores/purchase-orders/[id]`

**Purpose:** Direct/manual procurement order to a Supplier or Vendor. **No "create from RFQ" entry point exists on this page** — RFQ award creates POs via a separate internal call (see 3.3).

**Fields/inputs:** Partner Type (Supplier/Vendor) + partner select (warns if unqualified — non-blocking, "emergency purchases are legitimate"), Line Items (Item, Qty, Unit Price, computed Line Total), Expected Delivery Date, Notes.

**Actions/buttons:**
- **"Create Purchase Order"** → `DRAFT`. Numbering: **`PO-YYYY-####`**.
- **"Issue"** — DRAFT only → sets `issuedAt`, no longer editable.
- **"Cancel"** (destructive) — DRAFT or ISSUED only.
- **"Receive Goods (GRN)"** — ISSUED or PARTIALLY_RECEIVED → routes to `/stores/grn/new?poId=...`.

**Status enum:** `DRAFT → ISSUED → CANCELLED` (manual only). `PARTIALLY_RECEIVED`/`FULLY_RECEIVED` exist in the enum/UI but **no code path currently sets them** — reserved for a future GRN-driven computation phase.

**Who can do this:** `assertCanManagePurchaseOrders` — SUPER_ADMIN OR (MANAGER role AND SCM vertical).

**PO numbering:** **`PO-YYYY-####`**, same shared mechanism as RFQ.

### Discrepancies / uncertainties found — SCM / Procurement

1. "Only companyName + contactEmail required" — confirmed for both Vendor and Supplier at three independent layers (frontend, DTO, schema comment).
2. RFQ minimum invitee count (3) is confirmed real but enforced only at **issue** time, not creation — do not describe it as a creation-time rule.
3. **RFQ→PO linkage has no database foreign key** — traceable only via a free-text note on the PO.
4. `PARTIALLY_RECEIVED`/`FULLY_RECEIVED` PO statuses are not yet reachable in this codebase phase — don't imply an action produces them today.
5. **Frontend/backend role-gate mismatches**: RFQ detail's UI `canManage` check additionally shows buttons to plain `ADMIN`, but the backend rejects `ADMIN` (403) for RFQ management. Across all four SCM modules, "New X" buttons show for `SUPER_ADMIN || MANAGER` in the UI, but the real gate also requires SCM vertical — a Manager from another vertical sees the button but is rejected server-side.
6. RFQ **Award** requires the separate `isProjectManager` flag, not SCM-Manager status — an easy point of confusion for trainees.
7. Vendor and Supplier audits share one designation flag (`isInternalAuditor`) — there is no separate "Supplier Auditor" role.
8. "Internal fill" exists only for Suppliers, not Vendors.
9. No document numbering exists for Vendor or Supplier records at all — UUID only, unlike RFQ/PO.
10. No automated notification exists for RFQ award/loss outcomes.

---

## 4. Production / Stores

### 4.1 GRN (Goods Receipt Note) Entry — receiving materials against a PO

**Nav path:** Store Management → GRN Register (`/stores/grn`) → New GRN (`/stores/grn/new`) → GRN Detail (`/stores/grn/[id]`) → QC Inspection (`/stores/grn/[id]/inspect`)

**Purpose:** Record physical receipt of goods against an issued PO, with **zero stock impact until QC finalizes**.

**Fields/inputs (New GRN):**
- "Receipt Header": `GRN No.` (disabled, auto), `Received Date`, `Received By` (disabled), `PO Reference` (select — only ISSUED/PARTIALLY_RECEIVED POs), `Supplier / Vendor` (disabled, auto-filled).
- "Logistics" (once a PO is chosen): `Delivery Challan No.`, `Challan Date`, `Vehicle / AWB No.`, `Driver / Courier`, `Total Packages`, `Packing Condition`.
- "Items Received": `Part No. / Description`, `PO Qty`, `Prev. Received`, `Qty This GRN`, `Bin / Store` — inline over-receipt warning per line.
- "Receiving Remarks & Sign-off": `Receiving Remarks`, `Stores Keeper` (disabled), `Supervisor Sign-off`.

**Actions/buttons:**
- **"Save Draft"** → `DRAFT`.
- **"Send to QC Inspection"** → `DRAFT → PENDING_QC`. **Still zero stock movement.**
- GRN Detail: **"Send to QC Inspection"** (if DRAFT), **"Cancel"** (DRAFT/PENDING_QC only), **"Inspect (QC)"** (only if `PENDING_QC && isQcInspector`).

**Who can do this:** Any active **Production-vertical** employee or SUPER_ADMIN (`GrnAccessService.assertCanReceiveGoods`). Read is company-wide.

**GRN status enum:** `DRAFT → PENDING_QC → {QC_PASSED | QC_PARTIAL | QC_FAILED}`, or `CANCELLED`. Numbering: **`GRN-YYYY-####`**.

### 4.2 The QC inspection gate on GRN

**Nav path:** GRN Register → open a `PENDING_QC` GRN → **Inspect (QC)** → `/stores/grn/[id]/inspect`

**Purpose:** The mechanism that blocks goods from entering stock until QC inspects them. Receiving a GRN produces zero stock movement; only `finalizeQc` moves stock.

**Fields/inputs (Inspect Lines table):** Item, Received, Accepted (editing auto-computes Rejected), Rejected, Rejection Remarks (required if any rejection). Banner: *"Only the accepted quantity enters stock... Accepted + rejected must equal the received quantity on every line."*

**Actions/buttons:** **"Finalize & Update Stock"** (confirm — cannot be undone) → `POST /goods-receipt-notes/{id}/finalize-qc`.

**Who can do this — the actual gate:** A designated **QC Inspector** (`Employee.isQcInspector`) or SUPER_ADMIN (always implicitly a QC inspector). Non-inspectors see an empty state: "QC inspection is restricted." Backend is the real enforcement boundary.

**What happens next:** GRN resolves to `QC_PASSED`/`QC_FAILED`/`QC_PARTIAL`. Accepted quantity generates a `STOCK_IN`. Every line with `rejectedQuantity > 0` **automatically creates an OPEN NonConformanceReport** (one per rejected line, unique-constrained). The parent PO's receipt status is re-derived from cumulative accepted quantity. Over-receipt is allowed with only a non-blocking warning.

### 4.3 NCR (Non-Conformance Report) disposition

**Nav path:** Store Management → Non-Conformance (`/stores/ncr`) → detail (`/stores/ncr/[id]`)

**Purpose:** Disposition quality rejections raised automatically at the GRN QC gate.

**Fields/inputs (Disposition card, OPEN status):** `Disposition` (select: Return to Supplier / Rework / Use as Is / Scrap), `Disposition Notes` (optional).

**Actions/buttons:** **"Record Disposition"** → `OPEN → DISPOSITIONED`. **"Close NCR"** (once DISPOSITIONED) → `DISPOSITIONED → CLOSED`.

**Who can do this:** A **QC Inspector**, OR a **Production-vertical Manager or above**, OR SUPER_ADMIN — intentionally broader than the GRN QC-finalize gate. The frontend does **not** re-check `isQcInspector` here — relies entirely on the backend.

**What happens next:** Purely a paper trail — rejected quantity never entered stock in the first place, so disposition never touches inventory. Numbering: **`NCR-YYYY-####`** (this is the Stores/GRN NCR — a **separate series** from the QMS module's own NCR, see cross-reference in Appendix B).

### 4.4 Material Indent and Issue

**Nav path:** Store Management → Material Issue (`/stores/material-issue`) → **Raise Indent** → `/stores/material-issue/new-indent`; detail at `/stores/material-issue/[id]`

**Purpose:** Production raises an internal requisition; Stores fulfils it with one or more Material Issue Notes.

**Fields/inputs — Raise Indent:** Item, Requested Quantity, Project/Kickoff (optional — links reserved stock), Required By (optional), Notes.

**Fields/inputs — Issue dialog:** Requested/Already issued/Outstanding stats, Issue Quantity (validated against outstanding), Store Location, Bin Location. Short issue (< Outstanding) shows "Short Issue" warning; full issue shows "Full Issue" success. Footnote: *"Stock reserved for another project cannot be issued here."*

**Actions/buttons:** **"Raise Indent"** → `OPEN`. **"Issue"/"Short Issue"** → generates a reservation-aware `STOCK_OUT`. **"Cancel Indent"** (only if nothing issued yet).

**Who can do this:** Same gate as GRN receiving — any active Production-vertical employee or SUPER_ADMIN.

**What happens next:** Indent status is always derived: `OPEN → PARTIALLY_ISSUED → FULLY_ISSUED`; `CANCELLED` terminal only pre-issue. Numbering: Indent **`IND-YYYY-####`**; Issue Note **`MIN-YYYY-####`**.

### 4.5 Item Master stock movements

**Nav path:** Store Management → Item Master (`/scm/items`) for catalog; Store Management → Inventory (`/scm/inventory`) for stock balances.

**Purpose:** Item Master holds the catalog; Inventory shows current on-hand/reserved/blocked/available stock per item per location. Stock changes are an append-only `StockAdjustment` ledger, **but there is no frontend page that displays this movement history** — backend endpoint and client function exist, but zero callers found in the UI.

**Fields/inputs — "Adjust Stock" dialog:** Item, Store location, Bucket (On hand/Blocked), Quantity change (signed), Reason (required), Expected receipt qty/date (optional).

**Who can do this — real backend gate (important discrepancy vs. frontend):**
- Item create/update: **R&D Head** (`isRdHead`) or SUPER_ADMIN only.
- Inventory stock adjustment: **Store (Production-vertical)** staff or SUPER_ADMIN only.
- **The frontend's `canManage` check on both pages only checks `role === MANAGER/ADMIN/SUPER_ADMIN`** — does not check for R&D Head or Production vertical. A plain Sales/Finance Manager sees these buttons but gets a 403 on click.

**What happens next / where movements surface:** GRN QC-acceptance, Material Issue, and Dispatch all write `StockAdjustment` rows with a descriptive `reason`, queryable at `GET /inventory/items/{itemId}/adjustments` — but not rendered anywhere today.

### Numbering formats (confirmed)

All year-prefixed, 4-digit zero-padded, resetting annually: `GRN-2026-0001`, `NCR-2026-0001`, `IND-2026-0001`, `MIN-2026-0001`, `DC-2026-0001`. Item Master codes are continuous (never reset), 5-digit: `RM-00001`, `CM-00456`, `SA-00001`, `FG-00001`, `CN-00001`.

### Discrepancies / uncertainties found — Production / Stores

1. **Frontend "canManage" gate is looser than the real backend authority** on Item Master and Inventory — role alone is not sufficient for either; both require the specific `isRdHead` or Production-vertical checks. Flag explicitly in training so employees aren't confused when a visible button 403s.
2. **No frontend page shows stock movement/adjustment history**, despite backend support existing — may be a genuine build gap, not a documentation omission.
3. **`isQcInspector` silently grants broad Quality Management (QMS) module access** — any QC Inspector automatically becomes an `isQualityUser`, unlocking the entire separate QMS nav group. Easy to miss since it's not mentioned in Stores/GRN code comments.
4. **Two separate NCR registers exist** in this system: the Stores one (`/stores/ncr`, GRN-rejection-triggered, prefix `NCR`) and the QMS one (`/qms/ncrs`, broader quality-system NCR, prefix `QNCR`) — different models/modules, do not conflate in training material.
5. NCR disposition is **not** restricted to QC Inspectors alone — a Production Manager+ can also do it, and the frontend shows the form to anyone who reaches the page (no client-side `isQcInspector` check there, unlike the GRN inspect page).
6. QC Inspector designation itself requires role MANAGER or above — an `EMPLOYEE`-role person cannot be made a QC Inspector even by an Admin.
7. Final QC clearance (Logistics, §6) and GRN QC finalization are visually similar but operate on different entities and different nav areas — worth a clear diagram in training material to avoid conflation.

---

## 5. Quality — QC Inspector Role

### The `isQcInspector` flag

- **Field:** `Employee.isQcInspector` (Boolean, default false). Doc comment: *"QC Inspector capability (not a Role)... deliberately SEPARATE from isInternalAuditor... MULTIPLE holders allowed; SUPER_ADMIN is always a QC inspector regardless of this flag; MANAGER-or-above only."*
- **Who can designate/revoke:** ADMIN or SUPER_ADMIN only, via Admin → Employees → [employee detail]. Routes: `PATCH /employees/:id/designate-qc-inspector` / `.../revoke-qc-inspector`. Target must be `ACTIVE` and role MANAGER/ADMIN/SUPER_ADMIN. Badge shown: **"QC Inspector"**.
- **Every place `isQcInspector` gates something:**

| # | Location | What it gates |
|---|---|---|
| 1 | `grn-access.service.ts` → `assertCanInspect` | Finalizing the GRN QC gate |
| 2 | `grn-access.service.ts` → `assertCanDispositionNcr` | NCR disposition/close — QC Inspector OR Production Manager+ OR SUPER_ADMIN |
| 3 | `dispatch-access.service.ts` → `assertCanClearFinalQc` | Clearing outbound final QC on an Order (dispatch precondition) |
| 4 | `qms-access.service.ts` → `accessFor` | Grants `isQualityUser` — broad access to the ENTIRE separate QMS module |
| 5 | `use-is-qc-inspector.ts` | Frontend UI gate only |
| 6–9 | GRN detail/inspect pages, Dispatch New page, Admin employee page | Show/hide relevant buttons |

### 5.1 GRN incoming inspection

Covered fully in §4.2. QC Inspector (or SUPER_ADMIN) is the *only* role that can finalize a `PENDING_QC` GRN. Sole path that moves accepted stock into `StockBalance` and the sole path that spawns Stores NCRs.

### 5.2 Final QC before dispatch (a separate checkpoint)

This is a **distinct gate** from GRN incoming inspection, living on the **Order** (Sales) model, not the Delivery Challan.

- **Schema:** `Order.finalQcStatus` (`PENDING`/`CLEARED`), `finalQcClearedById`, `finalQcClearedAt`. Doc comment: *"Outbound final-QC clearance for finished goods. A dispatch cannot be created until this is CLEARED (mirrors the inbound GRN→QC gate)."*
- **Nav path:** Logistics → Dispatch Register → New Dispatch (`/logistics/dispatch/new`). Order picker shows a **Final QC:** badge (PENDING/CLEARED).
- **Action:** Only a QC Inspector/SUPER_ADMIN sees **"Clear Final QC"** → `POST /logistics/delivery-challans/orders/{orderId}/clear-final-qc`.
- **What it blocks:** "Create & Dispatch" is disabled while unqualified; backend re-checks server-side even if the frontend were bypassed.
- Training distinction: incoming QC (GRN) and outbound final QC (dispatch) are two separate checkpoints on two separate entities, but both use the identical `isQcInspector`/SUPER_ADMIN authority pattern.

### Discrepancies / uncertainties found — Quality

(Consolidated with §4's list above — the QC Inspector role spans both Production/Stores and Logistics, so its discrepancies are documented once, in §4's list, items 3–7.)

---

## 6. Logistics

### 6.0 Overview

Logistics & Dispatch covers outbound shipping: creating a **Delivery Challan (DC)** against a sales Order, dispatching it (issues stock + seeds a draft AR invoice), recording the **e-way bill**, capturing **Proof of Delivery (POD)**, and reporting **On-Time Delivery (OTD)**.

**Nav path:** Sidebar group **"Logistics"**, shown to Store (Production-vertical) staff, SCM-vertical staff, or SUPER_ADMIN: **Dispatch Register** (`/logistics/dispatch`), **OTD Analytics** (`/logistics/otd`).

### 6.1 Dispatch Register (list)

Company-wide read-only register: DC No. · Date · Order · Customer · Transport · Status · Invoice · E-Way Bill. Status filter. **"New Dispatch"** button visible to anyone who can see the page (backend enforces the real create gate).

### 6.2 New Dispatch (Delivery Challan creation)

**Nav path:** Dispatch Register → "New Dispatch" (`/logistics/dispatch/new`)

**Fields/inputs:** Order (select — non-CANCELLED, not FULLY_DISPATCHED; shows Final QC + Fulfilment badges), Line Items table with per-line "Dispatch Now" quantity (over-dispatch allowed with a warning), Consignee & Transport card (Consignee Name/GSTIN/Address, Place of Supply — State Code, Transport Mode, Transporter, Vehicle/AWB No., Driver Name/Phone, Promised Delivery Date, Dispatch Date, Special Delivery Instructions), Documents Included checklist (Delivery Challan, Commercial Invoice, E-Way Bill, Packing List, Certificate of Conformance, FAT Report, Quality Certificate, ISPM-15/Phytosanitary).

**Actions/buttons:** **"Clear Final QC"** (QC inspectors only, when pending — see §5.2). **"Save Draft"**. **"Create & Dispatch"** (disabled until Final QC cleared) — on success: *"{dcNumber} dispatched — stock issued and a draft invoice created."*

**Who can do this:** `DispatchAccessService.assertCanDispatch()` — **only an ACTIVE employee whose vertical is `PRODUCTION`, or SUPER_ADMIN**. SCM-vertical staff who see the nav item get a 403 on submit (read-only for them — see discrepancy #1).

**Numbering:** **`DC-YYYY-####`**.

### 6.3 Delivery Challan detail / actions

**Nav path:** Dispatch Register → click a row (`/logistics/dispatch/{id}`)

**Actions by status:**
- **DRAFT:** **"Dispatch"** (confirm: "This issues stock and creates a draft invoice"). **"Cancel"**.
- **DISPATCHED:** **"Mark In Transit"**.
- (No dedicated "Mark Delivered" — only reached via POD.)

**E-Way Bill card** (once DISPATCHED+): E-Way Bill No./Date/Valid Until, **"Save E-Way Bill"**. Can only be entered post-dispatch.

**Proof of Delivery card** (once DISPATCHED+): Received By, POD Document (file), Notes, **"Upload POD & Mark Delivered"** — presigned R2 upload, sets `actualDeliveryDate`, flips status straight to **DELIVERED** (skips "In Transit" if desired).

**Who can do this:** All mutating actions — same `assertCanDispatch` gate (Production-vertical or SUPER_ADMIN only). Reads company-wide.

**What happens next:** Dispatch posts `STOCK_OUT`, seeds a DRAFT AR invoice (see §6.4), flips DC to DISPATCHED, re-derives `Order.fulfilmentStatus`. Once DELIVERED with both dates set, eligible for OTD reporting.

### 6.4 The dispatch-to-invoice link (Delivery Challan → AR Invoice)

**How it works:** Dispatching a DC **automatically and atomically**, in one transaction: (1) posts `STOCK_OUT` for every line, (2) seeds a **DRAFT `SalesInvoice`** covering only that DC's lines, (3) flips the DC to DISPATCHED and sets `linkedInvoiceId`.

**There is no separate "create invoice" button anywhere in Logistics** — the controller comment states explicitly this is deliberate: dispatch seeds the invoice via a module-to-module call, bypassing the normal Finance access check, "not an HTTP route a logistics user can reach."

**GST rate seeding:** best-effort — flat 18% IGST if interstate, 9%+9% CGST/SGST if intrastate; Finance corrects at approval.

**Invoice status guarantee:** hardcoded `DRAFT` by construction — must go through Finance's own maker-checker (submit → Accounts Head approves, cannot be the creator → issue → GL posting). A Logistics/Production user cannot submit/approve/issue this invoice themselves.

### 6.5 OTD (On-Time Delivery) Analytics

**Nav path:** Logistics → OTD Analytics (`/logistics/otd`)

Read-only, company-wide, computed live from DC data (no cached metrics). Only DELIVERED DCs with both promised and actual dates count. Delay = `ceil((actual-promised)/day)`; ≤0 = on time. From/To date filters. Summary tiles, By Customer table, Dispatches table.

### Discrepancies / uncertainties found — Logistics

1. **Nav shows Logistics to SCM staff, but SCM staff cannot actually create/dispatch/POD** — the access-service only accepts Production vertical. SCM has read-only access to Dispatch Register/OTD; training must not imply creation rights.
2. QC Inspector designation is independent of vertical/role — a non-Production QC Inspector can clear Final QC but cannot themselves dispatch.
3. Invoice hand-off is a true silent module-to-module call — no "Create Invoice" button exists anywhere; the confirm-dialog text and success toast are the only in-product cues.
4. GST on the seeded invoice is a rough flat-18% placeholder, not item/HSN-specific — expected behavior, correctable by Finance at approval, not a bug.
5. Finance's Sales Vouchers list does not display which DC originated a given invoice — no DC-number column found; trace via the DC detail page's "Linked Invoice" field instead.
6. "Mark Delivered" has no dedicated button — only reachable via the POD flow; the backend technically permits a direct status PATCH but no UI wires it up.

---

## 7. Accounts / Finance

**Module access gate:** `FinanceAccessService` computes three flags every request:
- `isFinanceUser` — ACTIVE AND (SUPER_ADMIN OR vertical `ACCOUNTS`). "Any Accounts-vertical staff," plus SUPER_ADMIN override.
- `isAccountsHead` — ACTIVE AND `Employee.isAccountsHead === true`. Doc comment: *"Exactly one active holder at a time, assigned only by SUPER_ADMIN. Accounts-vertical staff prepare finance records; only this holder may approve/post them."*
- `isFinanceAuditor` — a time-bound `FinanceAuditorGrant` (read-only executive reporting; out of scope here).

`assertCanUseFinance` passes for `isFinanceUser` OR `isAccountsHead`. `assertAccountsHead` passes for `isAccountsHead` only.

### 7.0 Designating the Accounts Head

**Nav path:** Admin → Employees → (open an employee) — `/admin/employees/[id]`

**Who can do this:** SUPER_ADMIN only (`PATCH /employees/:id/designate-accounts-head` / `.../revoke-accounts-head`).

**Fields/labels:** card "Finance/Accounts Head designation"; button **"Designate as Accounts Head"** (becomes **"Revoke Accounts Head"** once set).

**What happens next:** Atomically unsets any prior holder, sets the new one. Target need not belong to the ACCOUNTS vertical, only `ACTIVE`. Badge "Finance/Accounts Head" appears next to the name. Revoking warns: "Finance approvals will stop until a new head is assigned."

### 7.1 Invoice creation (Sales Voucher / AR invoice)

**Nav path:** Vouchers → **Sales Vouchers** (`/finance/ar/invoices`); "New Sales Voucher" → `/finance/vouchers/sales/new`. Both write to the identical `POST /finance/ar/invoices` — the voucher-shell page is explicitly a Tally-shaped alternative surface over the same create path, not a new data path.

**Fields/inputs (voucher-entry page):** Voucher No. (shown "Auto", disabled), Date, **Party (Customer)**, Due Date, line panel (Description, HSN/SAC, Quantity, Unit Price, IGST %, Place of Supply State, State Code), live Subtotal/GST/Total, Narration.

**Actions/buttons:** **"Save as Draft"**, **"Submit for Approval"** (disabled until "balanced" — party + description + HSN + positive total).

**Who can do this:** `assertCanUseFinance` — any Accounts-vertical staff or the Accounts Head; SUPER_ADMIN implicitly via `isFinanceUser`.

**What happens next:** Invoice created `DRAFT`, numbered **`INV-YYYY-####`** (4-digit, resets yearly — via the shared `SalesNumberingService`, NOT the 5-digit private finance helper; confirmed by an explicit code comment: "Document numbers (INV-/RCT-) moved to the shared SalesNumberingService; the GL journal series stays on the shared financeSequence"). `outstandingAmount` initialized to the full total. Can also be seeded automatically from Logistics dispatch (module-to-module only, always DRAFT).

### 7.2 Submit / Approve (maker-checker)

**Status flow:** `DRAFT → PENDING_APPROVAL → (REJECTED | GST_PENDING | ISSUED) → PARTIALLY_PAID → PAID`, plus `OVERDUE`/`CANCELLED`.

**Actions/buttons:**
- **"Submit"** — DRAFT or REJECTED, any Accounts-vertical user. Server also runs credit-control checks; if blocked, the error tells the maker "Finance Head override is required" — the override screen itself lives on a nav-hidden page (`/finance/treasury`, see §7.6).
- **"Approve"/"Reject"** — `isAccountsHead` only, while PENDING_APPROVAL. Reject prompts for a reason.
- **Self-approval explicitly blocked**: `'The Finance Head cannot approve an invoice they created'` if creator === approver — the maker-checker enforcement this SOP was scoped to confirm.
- **"Send GST"** — `isAccountsHead` only, when GST_PENDING.

**What happens next on Approve:** If e-invoicing is enabled and the customer has a GSTIN, goes to `GST_PENDING` (retry-managed against the GST gateway). Otherwise straight to `issueAndPost`: balanced journal entry (Dr AR / Cr Revenue / Cr GST payable), invoice → `ISSUED`, linked Billing Milestone (if any) → `INVOICED`.

### 7.3 Receipt allocation (customer payment)

**Nav path:** Vouchers → **Receipt Vouchers** (`/finance/ar/receipts`, "Customer Receipts"); "New Receipt Voucher" → `/finance/vouchers/receipt/new`.

**Fields/inputs:** Party (Customer), Allocate to Invoice (or "Unapplied advance"), Amount, Bank Reference (UTR), Narration.

**Backend validation:** allocations must reference open invoices of the same customer, cannot exceed outstanding, cannot exceed `amount + tdsDeducted` in total.

**Numbering:** **`RCT-YYYY-####`** (4-digit — same shared `SalesNumberingService`, confirmed via the identical code comment as §7.1).

**Approve/Reject — same maker-checker shape:** `DRAFT → PENDING_APPROVAL → (REJECTED | POSTED) → REVERSED`. Same self-approval block.

**What happens next on Approve:** Full journal entry (Dr Bank net of charges, Dr Bank Charges/TDS if any, Cr AR for allocated amounts, Cr Customer Advances for unapplied remainder, plus realized FX gain/loss if non-INR). Allocated invoices flip to `PAID`/`PARTIALLY_PAID`. Receipt → `POSTED`.

### 7.4 Day Book

**Nav path:** Vouchers → **Day Book** (`/finance/daybook`), first item in the Vouchers group.

**Purpose:** Single, read-only, chronological ledger unioning all voucher types (SALES/PURCHASE/RECEIPT/PAYMENT/JOURNAL/CONTRA) from six live tables, newest-first, paginated (50 rows/page).

**Fields/inputs:** From/To date, Voucher type select, Refresh. **Note:** the frontend's type dropdown omits CONTRA (backend emits it) — see discrepancy #1.

**Who can view:** `assertCanUseFinance`.

### 7.5 Voucher screens — Tally label map vs. underlying routes

| Sidebar label | Route | Entity | Numbering | Voucher-entry page |
|---|---|---|---|---|
| Day Book | `/finance/daybook` | (aggregated) | n/a | n/a |
| Sales Vouchers | `/finance/ar/invoices` | `SalesInvoice` | `INV-YYYY-####` | `/finance/vouchers/sales/new` |
| Purchase Vouchers | `/finance/ap/invoices` | `AccountsPayableInvoice` | `BILL-YYYY-#####` | `/finance/vouchers/purchase/new` |
| Receipt Vouchers | `/finance/ar/receipts` | `CustomerReceipt` | `RCT-YYYY-####` | `/finance/vouchers/receipt/new` |
| Payment Vouchers | `/finance/ap/payments` | `AccountsPayablePayment` | `PAY-YYYY-#####` | `/finance/vouchers/payment/new` |
| Credit & Debit Notes | `/finance/adjustments` | `FinanceAdjustmentNote` | `CN-`/`DN-YYYY-#####` | none found (no Tally-styled entry form) |
| Journal Vouchers | `/finance/journals` | `JournalEntry` | `JV-YYYY-#####` | `/finance/vouchers/journal/new` |
| Contra Vouchers | `/finance/contra` | `ContraVoucher` | `CV-YYYY-#####` | `/finance/vouchers/contra/new` |
| Ledgers (Masters) | `/finance/accounts` | `LedgerAccount` | n/a | n/a (managed inline) |

Every voucher-entry screen shares one `VoucherShell` component: Voucher No. ("Auto", disabled), Date, type-specific body, Narration, balance badge, **"Save as Draft"** / **"Submit for Approval"**. None create new data paths — each posts to the same endpoint the flat register page already used.

### 7.6 Hidden-but-built finance areas

Reachable only by direct URL (deliberately not in nav, per `nav.ts` comment block): Bank Reconciliation, Exports & Audit Pack, Production Readiness, Budgets, Fixed Assets, Schedules & Analytics, **Treasury & Credit** (`/finance/treasury` — where the credit-limit override actually lives), Executive Reporting (`/finance/executive` — nav-visible, but only for `isFinanceAuditor` users).

### Discrepancies / uncertainties found — Accounts / Finance

1. **Day Book voucher-type filter mismatch**: backend emits CONTRA rows in the Day Book; the frontend dropdown's type list omits CONTRA — a real UI gap, not an intentional restriction.
2. **Credit-control override UX gap**: the submit-blocking error message tells the maker to seek a "Finance Head override," but that action lives on a nav-hidden page (`/finance/treasury`) — not link-reachable from the Sales Vouchers screen.
3. Credit & Debit Notes' label is hardcoded in `nav.ts` rather than sourced from the `FINANCE_LABELS` map like every sibling item — a minor convention inconsistency; also has no dedicated Tally-styled voucher-entry page.
4. `isAccountsHead`-gated approvals have **no SUPER_ADMIN override at the flag level** — unlike QMS/Design Heads (which still let SUPER_ADMIN into the *module*), `assertAccountsHead` checks only the real boolean with no role escape hatch found. See Appendix A's own discrepancy note on this — a SUPER_ADMIN who was never designated Accounts Head would be blocked from approving.
5. The one-holder invariant for Accounts Head is enforced only at the application layer (no DB-level unique constraint) — relies entirely on this being the sole writer of the flag, which holds today but is not schema-enforced.

---

## 8. HR

### 8.1 Onboarding a new employee — two distinct, non-interchangeable flows

#### Flow A — "Onboard Employee" (the real HR onboarding wizard)

**Nav path:** People → Onboard Employee (`/hr/onboard`). Shown only to Admin/SuperAdmin or HR-vertical staff.

**Purpose:** Step 1 of a two-step process. Creates the full personnel record but does **not** grant login access.

**Fields (5-step wizard):**
1. **Personal** — First/Last name, DOB, Gender, Personal email, Mobile, Emergency contact.
2. **Employment** — Vertical, Designation, Employment type, Date of joining, Work location.
3. **Compensation** (marked "Sensitive — encrypted") — Basic salary, HRA, Effective date.
4. **Statutory** (marked "Sensitive — encrypted") — PAN, Aadhaar (last 4 digits), PF account number, ESIC (the only optional field).
5. **Banking** (marked "Sensitive — encrypted") — Bank account number, IFSC code.

**Action button:** "Onboard Employee" (final step); "Next" on intermediate steps.

**Who can do this:** Controller decorator is broad, but the **service layer re-checks and restricts to Admin/SuperAdmin or HR-vertical staff** — the authoritative rule.

**What happens next:** Auto-generates an official email; `accessStatus` = `PENDING_ACCESS`; a personal Vault "My Documents" folder is auto-created. The employee **cannot log in** until an Admin performs **Grant Access** (`PATCH /employees/:id/grant-access`, Admin/SuperAdmin only) — sets role/vertical/password, flips to `ACTIVE`.

#### Flow B — Admin "Create Employee" (direct, one-step, bypasses onboarding)

**Nav path:** Administration → Employees (`/admin/employees`) → "Create Employee" → `/admin/employees/new`

**Purpose:** Directly creates a fully-active account in one step — no PII/compensation/statutory/banking capture.

**Fields:** First/Last name, Email, Initial password, Role (Admin option only if caller is SUPER_ADMIN), Vertical, Reporting manager, Designation/Employment type/Work location (all optional).

**Who can do this:** `POST /employees` is Admin/SuperAdmin only.

**What happens next:** `accessStatus: ACTIVE` immediately, can log in right away.

**Which flow is used by whom:** HR staff onboarding a genuine new hire use Flow A, then an Admin grants access. Flow B is an Admin-only shortcut (e.g. test/system accounts).

### 8.2 Roster (employee directory)

**Nav path:** People → Roster (`/hr/roster`)

**Fields shown:** Employee ID, Name, Vertical, Designation, Employment Type, Work Location, Access Status. Admin/HR-Manager viewers additionally see **Sensitive Info** (Complete/Incomplete badge) and row actions.

**Actions:** "View sensitive details" (Admin/HR-Manager only) — tabs Compensation (read-only, redirects to Salary Structures), Statutory (editable), Banking (editable); warning: "You are viewing sensitive PII. This action is recorded in the audit log." "Edit" (Admin/HR-Manager only) → `/admin/employees/:id`.

**Who can view the roster:** HR-vertical staff (any role) or Admin/SuperAdmin. Richer "admin" shape (Sensitive Info column + actions) only for Admin/SuperAdmin or HR-vertical **Manager**; plain HR-vertical employees see a lean read-only roster.

### 8.3 Leave & Attendance

Employee-facing self-service views live as tabs on "My Profile" (`/profile`), not standalone sidebar items — "My Team" (roster/leave-approvals/team-attendance) is no longer a separate sidebar group.

**Profile tabs:** Profile (always) · My Team + Leave Approvals (MANAGER/ADMIN/SUPER_ADMIN) · Team Attendance (MANAGER only, not Admin/SuperAdmin) · My Leave + My Attendance (always).

#### Applying for leave (self-service)

**Nav path:** Account dropdown → My Profile → "My Leave" tab

**Fields:** Balance cards (or "Unlimited" for UNTRACKED types); "Request Leave" dialog — Leave type, Start date, End date (hidden if Half day), Half day checkbox, Reason (required).

**Who can do this:** any authenticated employee — no `@Roles()` restriction.

**What happens next:** Validates no date-overlap and day-count. **SUPER_ADMIN's own requests auto-approve immediately** (no reporting manager to route to). Everyone else: `PENDING`, balance not deducted until approval.

#### Approving leave

**Nav path:** My Profile → "Leave Approvals" tab (manager scope: direct reports only); separately, Admin/HR → "All Pending Approvals" (`/admin/leave-approvals`, company-wide).

**Who can do this:** No `@Roles()` decorator — pure service-layer check. Self-approval always blocked; Admin/SuperAdmin act on anything; a Manager only on requests where they are the resolved approver (direct reports).

**What happens next on Approve:** Deducts balance (for tracked types) and snapshots the approver's e-signature. **Cancellation** (`PATCH /leave-requests/:id/cancel`): requester or approver, only while PENDING or (APPROVED and start date still future); cancelling a previously-approved request restores the balance.

**Note — no employee self-service "attendance correction request" flow exists.** Corrections are entirely an HR/Admin-initiated action (see below); an employee needing one must ask out-of-band.

#### Attendance — check-in/check-out (self-service)

**Nav path:** My Profile → "My Attendance" tab

Single contextual button: **"Check In"** → **"Check Out"** → disabled **"Done for today."** On approved leave: `ON_LEAVE` badge, no check-in needed.

**Who can do this:** any authenticated employee, self only — no `@Roles()` restriction.

**What happens next:** `status` is never stored — always derived live from check-in/out times plus same-day approved leave.

#### Team Attendance (manager view)

**Nav path:** My Profile → "Team Attendance" tab

Day-by-day grid, colored status dots. **Who can do this:** `MANAGER` role **only** — Admin/SuperAdmin explicitly excluded, a deliberate exception to the app's usual "Manager or Admin" pattern.

#### Attendance Corrections (HR/Admin manual)

**Nav path:** Sidebar → Leave & Attendance (Admin or HR Manager only) → "Attendance Corrections" (`/admin/attendance-corrections`)

**Fields:** Search employee, Date, Check-in/Check-out time (both editable). Warning: "This will be recorded as an admin correction and audited."

**Who can do this:** Admin/SuperAdmin or an **HR-vertical Manager** only (narrower than the broad controller `@Roles`).

### Discrepancies / uncertainties found — HR

1. **`isSalesHead` has no revoke endpoint** — every other single-holder flag (`isAccountsHead`, `isQmsHead`, `isDesignHead`) has a matching `revoke-*` route; Sales Head can only be *replaced*, never revoked to "no one" directly.
2. `POST /employees/onboard`'s controller decorator is broader than the actual enforced rule — the service layer's Admin/HR-vertical-staff check is authoritative, not the decorator.
3. No employee self-service "request an attendance correction" flow exists — corrections are HR/Admin-initiated only.
4. Two "create employee" flows coexist with materially different data-capture and activation semantics — do not conflate them in training.
5. Admin "Employees" list/detail pages use old-style unstyled raw HTML, unlike the polished components used elsewhere — a visual, not functional, inconsistency worth noting if the SOP includes screenshots.
6. Team Attendance (`GET /attendance/team`) is confirmed **MANAGER-only**, excluding Admin/SuperAdmin — an intentional exception, not a bug.

---

## 9. Cross-Cutting Features

### 9.1 Project Kickoff

**Nav path:** Projects → Project Kickoff (`/project-kickoff`). This whole "Projects" nav group (Kickoff + PLM) is hidden from HR-vertical and Accounts-vertical staff.

**Purpose:** A structured cross-functional record — attendees, milestones, action items (mirrored to Kanban cards), risks, delivery classification, and minutes.

**Access model:**
- **CREATE**: only `isProjectManager` (true for SUPER_ADMIN always, or `Employee.isProjectManager === true`).
- **VIEW**: creator, OR an internal attendee, OR SUPER_ADMIN. Explicitly **not** vertical- or team-wide.
- **EDIT/DELETE any sub-entity**: requires BOTH view access AND `isProjectManager` — so a non-PM internal attendee is confirmed **read-only**.

**Sections (detail page):** Overview & Scope, Attendees (Internal/External — mutually exclusive), Milestones (standalone, NOT Kanban-linked), Action Items (each auto-creates a linked Kanban card; status is derived live from the card's list), Risk Register, Delivery Classification, Minutes & Notes.

**Actions/buttons:** "New Kickoff" → dialog (Order, Project name, Meeting date & time, Mode, Location/link). "Mark Completed"/"Mark as Draft", "View Project Board", "Download PDF".

**What happens next:** Creating an Action Item auto-creates a Kanban card on the kickoff's board; deleting an item archives (not deletes) the card.

### 9.2 Kanban Boards

**Nav path:** Boards → "Boards" (`/kanban`) and "Sprints" (`/kanban/sprints`) — ungated in the nav itself; individual-board visibility is membership-scoped server-side.

**Access model:**
- **Board creation**: genuinely open to **any employee** — no access check exists in the service, only the base authenticated-role guard. (A stale Swagger doc comment on this route still says "Scrum Master / SUPER_ADMIN only" — it is wrong.)
- **Creator carve-out (lists only)**: the board's own creator can manage lists even without being a Scrum Master. Does **not** extend to sprints/members/labels.
- **Sprints/members/labels**: requires a real Scrum Master (`isScrumMaster`, or SUPER_ADMIN always) who is **also a board member** — no creator exception here.
- **Card assignment to a non-member is allowed** — assignment itself is the sharing mechanism, granting the assignee a restricted "card-only" view (see the assignee's own card, comment/attachments-view only; no board chrome, no other cards/lists/sprints visible).

**Exact UI text:** "+ New Board" / "New list" / "Add a card" / "Set as done" (→ "Counts as done"); Assignee field helper: "Any employee — assigning someone who isn't a board member gives them access to just this card."

### 9.3 Personal Dashboard

**Nav path:** Home → Dashboard (`/dashboard`) — the universal post-login landing route for every role.

**Purpose:** A single aggregator page, identical markup for every role — no backend "dashboard" module exists; purely client-side composition of employee/kanban/kickoff/PLM endpoints.

**Sections:** Greeting + quote-of-the-day; conditional "most urgent task" banner; stat-card grid (Assigned/Completed/Due soon/Overdue, always shown); "My tasks"; "Project progress" (only if the user has kickoff projects); "Product lifecycle work" (only if PLM work exists); "Understand the process" (omitted for SUPER_ADMIN or no-vertical users).

### 9.4 Vault

**Nav path:** Vault → Documents (`/vault`) — deliberately ungated in the nav; content is access-scoped by the backend, computed live on every read.

**Folder types:** `PERSONAL` (auto-provisioned, one per employee, private, undeletable), `DEFAULT` (SUPER_ADMIN-created org folders, company-wide or vertical-scoped), `CUSTOM` (Manager+-created team folders, scope forced to TEAM around the creator's downstream hierarchy).

**Visibility scopes:** `PRIVATE`, `TEAM`, `VERTICAL`, `COMPANY_WIDE` — additive on top of explicit permission grants and internal/external shares. SUPER_ADMIN full override.

**Who can do what:** Create DEFAULT folder = SUPER_ADMIN only. Create CUSTOM folder = MANAGER+. Upload requires folder write access. Delete a DEFAULT folder = SUPER_ADMIN only.

### 9.5 Notification System

**Nav placement:** Bell icon in the top bar. Polls unread-count every 60s + on focus; loads the feed (capped 50) lazily on open. No websocket/SSE.

**All 14 `NotificationType` values, trigger, and recipient:**

| Type | Trigger | Recipient |
|---|---|---|
| `CARD_ASSIGNED` | Kanban card gets a new assignee | The newly assigned employee |
| `CARD_COMMENTED` | Comment added to a card | The card's current assignee |
| `CARD_UPDATED` | Meaningful field/sprint change | The card's current assignee |
| `VENDOR_QUESTIONNAIRE_SUBMITTED` | Vendor submits self-assessment | The SCM employee who created the vendor |
| `SUPPLIER_QUESTIONNAIRE_SUBMITTED` | Supplier submits self-assessment | The SCM employee who created the supplier |
| `BOM_SUBMITTED` | BOM submitted for approval | Every active `isRdHead` |
| `BOM_APPROVED` / `BOM_REJECTED` | BOM decision | The BOM's creator |
| `QMS_ACTION_ASSIGNED` / `QMS_ACTION_OVERDUE` | CAPA action assigned / cron-detected overdue | The action's owner |
| `PLM_DESIGN_REVIEW_REQUESTED` | Design submitted for review | Every active `isProductionHead` |
| `PLM_DESIGN_REVIEW_DECIDED` | Design Review approved/rejected | Submitter + tracker owner |
| `PLM_STAGE_ADVANCED` | A PLM stage confirmed | The tracker owner |
| `PLM_PRODUCTION_UPDATE` | Vendor self-report or auditor site-visit update | The tracker owner |

**Hard rule:** no method ever notifies a user about their own action. Clicking a notification deep-links by type — **except BOM_* notifications, which have no click-through target** (see discrepancy).

### Discrepancies / uncertainties found — Cross-Cutting

1. Kanban board-creation Swagger text ("Scrum Master / SUPER_ADMIN") is stale/wrong — the actual code has zero role check on board creation.
2. **BOM notifications don't deep-link** — clicking one just marks it read; no navigation occurs.
3. `KanbanList`'s schema doc-comment ("Created by Scrum Master / SUPER_ADMIN only") is outdated relative to the live creator-carve-out logic; treat the access-service code, not schema comments, as ground truth for Kanban list/board authority.
4. Everything else cross-checked (Vault permission tiers, Dashboard section conditions, Kickoff attendee dual-mode, action-item Kanban linkage) matched between backend and frontend with no gap found.

---

## 10. PLM (Product Lifecycle Management)

### 10.1 Overview, the three flows, and how `deliveryType` selects one

There is **no manual "create PLM tracker" action** anywhere in the UI. A `PlmTracker` row is created automatically, one per order line item, the moment a line's delivery classification is saved during Project Kickoff (idempotent upsert).

**Nav path:** Projects → Product Lifecycle (`/plm`) — dashboard of order-line progress. Per-order detail lives inline on the Sales Order page as a **"Product lifecycle"** card, anchored at `#plm`.

**`OrderLineDeliveryType` enum** — exactly three values: **NPD**, **IN_HOUSE**, **VENDOR**. Set per order line during Project Kickoff's **Delivery Classification** section (select + vendor-detail fields, shown only for VENDOR/IN_HOUSE). Once a tracker exists, `deliveryType` becomes **immutable**.

**Stage-sequence selection:**
- **NPD** → starts at `DESIGN`, full 9-stage sequence: DESIGN → DESIGN_REVIEW → DRAWING_RELEASE → RELEASE_TO_SCM → MATERIAL_PLANNING → PRODUCTION → QC → DISPATCH → COMPLETED.
- **IN_HOUSE** and **VENDOR** both skip Design/Design Review/Drawing Release entirely and start at `RELEASE_TO_SCM`, following the shorter 6-stage sequence.

### 10.2 Design stage (NPD only)

**Purpose:** Design/R&D staff prepare the design before review. No PLM-specific form — the actual authoring happens in the separate Design module.

**Action/button:** **"Submit Design Review"** — visible only while `currentStage === DESIGN`.

**Who can do this:** SUPER_ADMIN, OR an ACTIVE employee with `isDesignHead` or `isRdHead`, OR whose vertical is DESIGN or RND.

**What happens next:** Stage → `DESIGN_REVIEW`, status `PENDING`. Notifies every active `isProductionHead` (`PLM_DESIGN_REVIEW_REQUESTED`).

### 10.3 Design Review — approval/rejection (NPD only)

**Purpose:** Maker-checker gate — a Production Head must approve or reject before drawings can be released.

**Actions/buttons:** **"Approve"** / **"Reject"** — shown only while pending AND viewer is SUPER_ADMIN or `isProductionHead`.

**Confirmed server-side (not just UI-hidden):**
- **Self-approval is blocked**: `'You cannot approve your own Design Review'` if the reviewer is the submitter.
- **Rejection requires a non-empty comment** — enforced by DTO validation (`@MinLength(1)`, non-optional). Approval carries no comment field at all — asymmetric by design.

**What happens next:** Approve → stage `DRAWING_RELEASE`. Reject → back to `DESIGN`, with the comment stored. Notifies the submitter + tracker owner (`PLM_DESIGN_REVIEW_DECIDED`).

### 10.4 Drawing Release (NPD only, but the mechanism is universal — "derived" stage)

**No dedicated action exists.** Drawing Release advances automatically the moment its precondition is met — checked when the generic "Confirm ___" button (§10.6) is pressed.

**Precondition:** the line's Item must have at least one BOM in `RELEASED` status. PLM does not release drawings itself; it only waits for a released BOM to exist elsewhere in the system. Dashboard blocker text if unmet: **"Released BOM required."**

### 10.5 Release to SCM

**Purpose:** Hand off from Design/Drawing-Release (or, for IN_HOUSE/VENDOR, straight from tracker creation) to Material Planning/Procurement.

**Action/button:** generic **"Confirm Release To Scm"** (label is auto-humanized from the stage enum, no special-casing of the SCM acronym).

**⚠ Correction to a prior spec assumption:** there is **no code distinguishing "Phaze's own SCM team" procurement from "a vendor's own SCM/procurement"** at this stage — the transition is a single unconditional line, identical for NPD, IN_HOUSE, and VENDOR flows, gated only by the generic owner/Production-Head/SUPER_ADMIN check. If a prior spec described a Phaze-vs-vendor-SCM branching check here, that check does not exist in the current code and no evidence was found that it ever did.

### 10.6 The generic "Confirm stage" action

Applies to Release to SCM, Material Planning, Production, and (as a gate-check + rubber-stamp) the derived stages Drawing Release/QC/Dispatch. One shared endpoint and one shared button whose label text changes with the current stage (`Confirm {StageName}`) — these are **not** three or four separately implemented buttons.

**Who can do this:** the tracker's `ownerId` (defaults to the linked Order's owner), OR a Production Head, OR SUPER_ADMIN.

**Owner reassignment:** `PATCH /plm/trackers/:id/owner` — Production Head (or SUPER_ADMIN) only.

### 10.7 Material Planning — the BOM/stock-shortfall gate

**Purpose:** Ensure material requirements are fully resolved against live stock before releasing into Production.

**The gate, precisely:** reuses the exact same BOM-explosion/stock-availability engine built for Project Kickoff's "Material Stock Availability" report, filtered to this order line. Blocks completion if any leaf item is classified:
- **`SHORTAGE`** — a deficit with no (or insufficiently future-dated) covering expected receipt, OR
- **`UNKNOWN`** — no stock-balance record exists for that item at all.

A deficit that **is** covered by a future-dated expected receipt (`EXPECTED_BEFORE_REQUIRED_DATE`) does **not** block. Also blocks if no stock report has been generated yet for the kickoff, or if the line isn't part of any BOM selection in that report (e.g. no released BOM). Dashboard blocker text: **"Material shortage or unknown stock."**

**What happens next:** stage → `PRODUCTION`.

### 10.8 The Production stage

**Kanban board linkage — reused, not auto-provisioned per tracker.** A tracker does **not** get its own dedicated board — every tracker under an order/kickoff points at the *same single board* the Project Kickoff itself provisioned. A separate `PATCH /plm/trackers/:id/production-board` endpoint exists to repoint a tracker to a different board later, but **no frontend UI calls it** — API-only escape hatch.

**Card-completion count — a live query, not a stored counter.** Cards link to a tracker one at a time via a `plmTrackerId` field — but **there is no frontend control to set it** when creating/editing a Kanban card; linking is API-only today. The `{done}/{total}` count (done = card's list is a "done" list) is recomputed live on every read and shown in three places: the order-detail PLM card, the `/plm` workspace list, and the dashboard's PLM work card.

**Hand-off to QC — an explicit human action, NOT automatic on card completion.** Card-completion count is purely informational. Advancing Production → QC requires clicking the same generic "Confirm Production" button described in §10.6 — **no precondition on card counts exists at all.**

**Who can click it:** same generic gate — tracker owner, Production Head, or SUPER_ADMIN.

### 10.9 QC and Dispatch as derived stages

Both are "derived" exactly as their gate-check + rubber-stamp mechanism — real status of record lives elsewhere; the tracker just reflects and re-confirms it.

**QC derivation:** mirrors the order line's QMS Inspections — blocks unless at least one inspection is `PASSED` or `CONDITIONAL_PASS`. Dashboard blocker: **"Passed QC inspection required."**

**Dispatch derivation:** mirrors the order line's Delivery Challan lines — blocks unless at least one challan line's DC status is `DISPATCHED`/`IN_TRANSIT`/`DELIVERED`. Dashboard blocker: **"Dispatched challan required."** Confirming this completes the tracker (`status: COMPLETED`).

Neither QC, Dispatch, nor Drawing Release has its own writable status field on the tracker — `currentStage` is the only stored value; the derived booleans are recomputed live from the QMS/Logistics/BOM records respectively.

### 10.10 The vendor self-report flow (VENDOR flow only)

**The token link — internal side:** on the order's PLM section, per VENDOR-flow tracker, a **"Vendor update links"** block: **"Create link"** generates a `{origin}/public/plm-vendor-update/{token}` URL (copied to clipboard automatically), default expiry 336 hours (14 days, not adjustable from this UI). **"View links"** lists existing invites with **"Revoke"**. Gated to tracker owner/Production Head/SUPER_ADMIN.

**The public page** (`/public/plm-vendor-update/[token]`, unauthenticated, optional password): three percent sliders — **"Fabrication"**, **"Surface finish"**, **"Assembly"** — plus a **"Notes"** textarea and up to 5 progress photos. **"Submit progress update"**. Server enforces the tracker must be `flowType === VENDOR` and **literally in the Production stage** — self-reporting outside Production is blocked.

**The provenance banner distinguishing vendor self-report from an internal auditor's site-visit update:**
- **Vendor-facing page**: a distinct blue-tinted banner, eyebrow text **"Update provenance"**, body **"Updated by: {vendorName}"**, reassurance line: *"This submission will be recorded as a vendor self-report and retained in the PLM timeline."*
- **Internal side** (order detail, "Production update history" list): no separate colored banner — provenance shown inline as **"Updated by: {reporterDisplayName}"**, with the literal suffix **" (site visit)"** appended only for internal-auditor records; vendor self-reports get no suffix.
- Backed by a two-value enum: `VENDOR_SELF_REPORT` vs. `INTERNAL_AUDITOR_VISIT`, each with its own recipient-facing name-snapshot logic.

**Internal auditor's own recording UI:** shown only for VENDOR-flow + Production-stage + `canAudit` (Internal Auditor or SUPER_ADMIN). Same three percentages + notes + photos. Button: **"Save site-visit update"**. Subtext: *"The update will be attributed to you and marked 'site visit'."*

**Notification on either report type:** `PLM_PRODUCTION_UPDATE` to the tracker owner, with different message text per source.

### 10.11 The PLM rollup view on the Order detail page

Renders as the last section on the Order page: **"Product lifecycle"** card, subtext *"Per-line progress from kickoff through dispatch,"* with a **"Refresh"** button. Each line's tracker is a collapsible row showing: product name+SKU, flow type, owner, a color-coded current-stage badge, and a full horizontal **stage-stepper** (9-step for NPD, 6-step for IN_HOUSE/VENDOR). Expanding a tracker shows: the production card-completion callout (if in Production), contextual action buttons, vendor-invite management, the auditor site-visit form, full "Production update history," and a full `PlmTrackerEvent` audit **"Timeline."** There is no separate compact table view — it's an accordion of full detail cards, one per order line.

### Discrepancies / uncertainties found — PLM

1. **Confirmed, not drift:** `Employee.isProductionHead` exists exactly as named — a company-wide capability flag, multiple holders allowed, MANAGER-or-above only to designate, SUPER_ADMIN implicit throughout PLM access.
2. **Confirmed:** Design Review self-approval is blocked server-side (not just UI-hidden), and rejection requires a non-empty comment enforced at the DTO layer.
3. **The "Phaze-SCM-vs-vendor-SCM check" at Release to SCM does not exist in the current code** — flagged for correction in any prior spec that described it; recommend removing that line item or confirming with engineering whether it was ever built.
4. **Confirmed and more specific than "just a shortage row":** the Material Planning gate blocks specifically on `SHORTAGE` (uncovered deficit) or `UNKNOWN` (no stock record) — a deficit covered by a future-dated expected receipt does not block.
5. `PLM_DESIGN_REVIEW_REQUESTED` is a fourth PLM notification type (fires at Design submission, not decision) worth documenting alongside the three explicitly named in scope.
6. **No frontend UI exists to link a Kanban card to a PLM tracker** — the field and validation exist server-side only; today this can only be done via direct API call. Training should not imply a "link to PLM" dropdown exists on card creation.
7. Card completion count does **not** gate or auto-trigger the Production→QC handoff — purely informational; the actual advance is the manual "Confirm Production" button with zero card-count validation.
8. "Confirm Production," "Confirm QC," and "Confirm Dispatch" are one generic mechanism whose label changes with context — describe it that way in training, not as three separate buttons.
9. The `PATCH /plm/trackers/:id/production-board` re-linking endpoint has no frontend caller anywhere — API-only capability.
10. The vendor-invite default expiry (14 days) has no picker in the "Create link" UI — every link created from the UI silently gets the default with no way to change it short of a direct API call.

---

## Appendix A — Designation & Approval-Authority Reference

**`Role` enum** (`Employee.role`): exactly four values — `SUPER_ADMIN`, `ADMIN`, `MANAGER`, `EMPLOYEE`.

**Boolean designation flags on `Employee`** (independent of `Role`): exactly ten exist in the system — `isSalesHead`, `isScrumMaster`, `isProjectManager`, `isInternalAuditor`, `isRdHead`, `isAccountsHead`, `isQcInspector`, `isQmsHead`, `isDesignHead`, `isProductionHead`. No others exist on the model.

| Flag | Prisma field | Designate / Revoke endpoint | Who can grant | Extra constraints | What it's required for | SUPER_ADMIN override on the flag itself? |
|---|---|---|---|---|---|---|
| Sales Head | `isSalesHead` | `designate-sales-head` (**no revoke endpoint exists**) | ADMIN, SUPER_ADMIN | Target ACTIVE. Single holder, atomic swap. | Bid/No-Bid assessment review; Order Confirmation Sheet countersignature | Yes (explicit fallback + routing fallback) |
| Scrum Master | `isScrumMaster` | `designate-scrum-master` / `revoke-scrum-master` | ADMIN, SUPER_ADMIN | Target ACTIVE. Multiple holders. | Kanban sprint/member/label management (must also be a board member); one alternative for list management | Yes — always a Scrum Master regardless of the flag |
| Project Manager | `isProjectManager` | `designate-project-manager` / `revoke-project-manager` | ADMIN, SUPER_ADMIN | Target ACTIVE + role MANAGER+. Multiple holders. | Project Kickoff create/manage; RFQ award decision | Yes |
| Internal Auditor | `isInternalAuditor` | `designate-internal-auditor` / `revoke-internal-auditor` | ADMIN, SUPER_ADMIN | Target ACTIVE + role MANAGER+. Multiple holders. | Vendor & Supplier Qualification audits (same flag audits both); PLM vendor site-visit updates; PLM view access without ownership | Yes |
| R&D Head | `isRdHead` | `designate-rd-head` / `revoke-rd-head` | ADMIN, SUPER_ADMIN | Target ACTIVE; must be R&D vertical unless target role is SUPER_ADMIN. Multiple holders. | BOM approve/reject; Item Master technical-data management; one alternative for PLM Design Review submission | **No** — SUPER_ADMIN can manage the designation but does not gain BOM approval authority itself; only a real holder may approve a BOM |
| Finance/Accounts Head | `isAccountsHead` | `designate-accounts-head` / `revoke-accounts-head` | **SUPER_ADMIN only** | Target ACTIVE. Single holder, atomic swap. Any vertical allowed. | Nearly every Finance approve/reject/post/reverse action across the entire Finance suite | **No** at the specific approval-gate level (see discrepancy below) — though SUPER_ADMIN does get general Finance module access via a separate flag |
| QC Inspector | `isQcInspector` | `designate-qc-inspector` / `revoke-qc-inspector` | ADMIN, SUPER_ADMIN | Target ACTIVE + role MANAGER+. Multiple holders. | GRN QC-gate finalization; NCR disposition (one of several alternatives); outbound final-QC clearance; grants broad QMS module entry | Yes |
| QMS Head | `isQmsHead` | `designate-qms-head` / `revoke-qms-head` | **SUPER_ADMIN only** | Target ACTIVE. Single holder, atomic swap. | Sole QMS approval authority (templates, plans, NCR disposition, CAPA verification, audits, calibration, complaints, reports) | Module entry yes; the Head-specific approval gate itself, no |
| Design Head | `isDesignHead` | `designate-design-head` / `revoke-design-head` | **SUPER_ADMIN only** | Target ACTIVE. Single holder, atomic swap. | Sole Design Engineering release authority (documents, changes, reviews, templates, transmittals); one alternative for PLM Design Review submission | Module entry yes; the Head-specific approval gate itself, no |
| Production Head | `isProductionHead` | `designate-production-head` / `revoke-production-head` | **SUPER_ADMIN only** | Target ACTIVE + role MANAGER+. Multiple holders. | PLM Design Review approval/rejection (no self-approval); tracker owner reassignment; one alternative for stage-confirm/view actions | Yes — "implicit in PLM access" |

**How someone gets designated, in one sentence:** an Admin (or, for the five SUPER_ADMIN-only flags, only a SuperAdmin) opens that employee's detail page under Admin → Employees, and clicks a designate/revoke button that calls the corresponding `PATCH /employees/:id/designate-*` or `revoke-*` endpoint — there is no separate approval workflow for the designation itself.

### Vertical membership vs. boolean flag — read this before assuming a "staff" gate is a flag

Several capabilities that look like designation flags are actually derived purely from **which `Vertical` an employee belongs to** (`Employee.verticalId`), checked live at request time — a completely separate mechanism with no dedicated grant endpoint of its own:

- **HR staff** — role ∈ {MANAGER, EMPLOYEE} AND vertical `HR`.
- **Sales staff** — vertical `SALES`.
- **R&D staff** — vertical `RND`.
- **Store staff** — modelled as the **`PRODUCTION`** vertical; there is **no dedicated "Store" vertical or flag** — the codebase explicitly reuses PRODUCTION for this.
- **SCM staff** — vertical `SCM`.
- **Finance/Accounts-vertical staff** (`isFinanceUser`) — vertical `ACCOUNTS` OR SUPER_ADMIN — distinct from the `isAccountsHead` designation flag above.
- **Design/Engineering staff** (`isDesignUser`) — vertical ∈ {DESIGN, ENGINEERING, RND} OR `isDesignHead` OR SUPER_ADMIN.
- **Quality staff** (`isQualityUser`) — NOT vertical-derived at all: `isQcInspector || isQmsHead || SUPER_ADMIN` — no QMS vertical concept exists.

Vertical membership is just a field (`verticalId`) set at employee creation or edit (Admin/SuperAdmin, or HR-vertical Manager) — no single-holder rule, no dedicated grant workflow, and multiple employees freely share the same vertical.

### Discrepancies / uncertainties found — Appendix A

1. **`isAccountsHead` has no SUPER_ADMIN override at the specific approval-gate check** (`assertAccountsHead`) — unlike QMS/Design Heads, whose module-entry flags still admit SUPER_ADMIN via a separate OR-clause, Finance's Head-only gate checks only the raw boolean with no role escape hatch found anywhere in the access service. This may be intentional (mirroring the R&D-Head/BOM pattern) or an oversight — no code comment confirms which.
2. `isQmsHead`/`isDesignHead` follow the identical pattern: SUPER_ADMIN reaches the module, but not the Head-specific approval actions, without the real flag.
3. `FinanceAuditorGrant` is a related but distinct time-bound read-only grant (not one of the ten `Employee` boolean flags) — included for completeness, not counted among the ten.
4. `isSalesHead` has no revoke endpoint (cross-referenced from §8's HR discrepancies) — can only be replaced, not revoked to nobody.

---

## Appendix B — Document Numbering Reference

All year-prefixed formats reset their counter every calendar year; continuous formats never reset (backed by a sentinel year-0 row).

| Document | Prefix / format | Yearly or continuous | Module |
|---|---|---|---|
| Lead | `LD-YYYY-####` (4-digit) | Yearly | Sales |
| Bid / Quotation | `BID-YYYY-####` (4-digit) | Yearly | Sales |
| Order | `ORD-YYYY-####` (4-digit) | Yearly | Sales |
| Order Confirmation Sheet | `OC-YYYY-####` (4-digit) | Yearly | Sales |
| RFQ | `RFQ-YYYY-####` (4-digit) | Yearly | SCM |
| Purchase Order | `PO-YYYY-####` (4-digit) | Yearly | SCM |
| Goods Receipt Note | `GRN-YYYY-####` (4-digit) | Yearly | Production/Stores |
| Non-Conformance Report (Stores, GRN-triggered) | `NCR-YYYY-####` (4-digit) | Yearly | Production/Stores — **separate series from QMS's own NCR below** |
| Material Indent | `IND-YYYY-####` (4-digit) | Yearly | Production/Stores |
| Material Issue Note | `MIN-YYYY-####` (4-digit) | Yearly | Production/Stores |
| Delivery Challan | `DC-YYYY-####` (4-digit) | Yearly | Logistics |
| Item code — Raw Material | `RM-#####` (5-digit) | Continuous | R&D / Item Master |
| Item code — Component | `CM-#####` (5-digit) | Continuous | R&D / Item Master |
| Item code — Subassembly | `SA-#####` (5-digit) | Continuous | R&D / Item Master |
| Item code — Finished Good | `FG-#####` (5-digit) | Continuous | R&D / Item Master |
| Item code — Consumable | `CN-#####` (5-digit) | Continuous | R&D / Item Master — note: same `CN` text is separately reused by Finance's Credit Note; no collision (different backing table/entity key) |
| Sales (AR) Invoice | `INV-YYYY-####` (4-digit) | Yearly | Finance — via the shared Sales numbering service |
| Customer Receipt | `RCT-YYYY-####` (4-digit) | Yearly | Finance — via the shared Sales numbering service |
| AP Invoice (internal bill number) | `BILL-YYYY-#####` (5-digit) | Yearly | Finance — private per-module sequence |
| AP Payment | `PAY-YYYY-#####` (5-digit) | Yearly | Finance — private per-module sequence |
| Journal Voucher | `JV-YYYY-#####` (5-digit) | Yearly | Finance |
| Contra Voucher | `CV-YYYY-#####` (5-digit) | Yearly | Finance |
| Credit Note / Debit Note | `CN-YYYY-#####` / `DN-YYYY-#####` (5-digit) | Yearly | Finance |
| Advance Application | `ADV-YYYY-#####` (5-digit) | Yearly | Finance |
| Fixed Asset | `FA-YYYY-#####` (5-digit) | Yearly | Finance |
| Finance Schedule (recurring journal template) | `SCH-YYYY-#####` (5-digit) | Yearly | Finance |
| Opening Balance Import | `OB-YYYY-#####` (5-digit) | Yearly | Finance |
| Bank Reconciliation Statement | `BRS-YYYY-#####` (5-digit) | Yearly | Finance |
| FX Revaluation Run | `FX-YYYY-##` (2-digit) | One per accounting period | Finance — uses the period's own number, not an independent counter |
| Management Report Pack | `MRP-YYYY-####` (4-digit) | Yearly | Finance |
| TDS Challan | *(caller-supplied, not generated)* | N/A | Finance — assembled from user-entered fields, not sequence-backed |
| Design Request | `DR-YYYY-#####` (5-digit) | Yearly | Design |
| Design Project | `DP-YYYY-#####` (5-digit) | Yearly | Design |
| Design Document (drawing) | `DWG-YYYY-#####` (5-digit) | Yearly | Design |
| Engineering Change Request | `ECR-YYYY-#####` (5-digit) | Yearly | Design |
| Design Review | `DRR-YYYY-#####` (5-digit) | Yearly | Design |
| Design Project Template | `DPT-YYYY-#####` (5-digit) | Yearly | Design |
| Design Transmittal | `DT-YYYY-#####` (5-digit) | Yearly | Design |
| Engineering Change Order (report) | `ECO-YYYY-#####` (5-digit) | Yearly | Design |
| Design Requirement | `REQ-###` (3-digit, no year) | Continuous, per-project only | Design — not sequence-table backed |
| Quality Plan | `QP-YYYY-#####` (5-digit) | Yearly | QMS |
| Inspection | `QI-YYYY-#####` (5-digit) | Yearly | QMS |
| Non-Conformance Report (QMS) | `QNCR-YYYY-#####` (5-digit) | Yearly | QMS — **separate series from Stores' `NCR-YYYY-####`** |
| CAPA | `CAPA-YYYY-#####` (5-digit) | Yearly | QMS |
| Audit Programme | `QAP-YYYY-#####` (5-digit) | Yearly | QMS |
| Audit | `QA-YYYY-#####` (5-digit) | Yearly | QMS |
| Quality Report | `QR-YYYY-#####` (5-digit) | Yearly | QMS |
| Calibration Record | `CAL-YYYY-#####` (5-digit) | Yearly | QMS |
| Customer Complaint | `CC-YYYY-#####` (5-digit) | Yearly | QMS |
| Employee ID | `EMP-####` (grows unpadded past 4 digits) | Continuous | HR — a plain native Postgres sequence, not the shared numbering table |

**Note on this appendix's own internal correction:** an earlier research pass on this table listed the Sales AR Invoice (`INV`) and Customer Receipt (`RCT`) as 5-digit. Cross-checked directly against the Finance module's own code comment — *"Document numbers (INV-/RCT-) moved to the shared SalesNumberingService... the GL journal series stays on the shared financeSequence"* — and against the shared numbering service's own 4-digit-padding implementation. **`INV`/`RCT` are confirmed 4-digit**, matching every other Sales-numbered document, not 5-digit like the private Finance-only sequences (`BILL`, `PAY`, `JV`, `CV`, etc.). The table above reflects the corrected value.

### Discrepancies / uncertainties found — Appendix B

1. **No PV (Purchase Voucher) or RV (Receipt Voucher) prefix exists** in this codebase — only `JV`/`CV`/`RCT`/`BILL`/`PAY`. There is no separate "Sales Voucher" document either — that role is filled by the AR Sales Invoice (`INV`).
2. **NCR is two entirely separate series**, not one: Stores' GRN-triggered `NCR-YYYY-####` (4-digit) vs. QMS's own `QNCR-YYYY-#####` (5-digit) — two different underlying models with two independent counters.
3. **PLM trackers have no human-readable number at all** — identified only by UUID and their 1:1 relation to the order line.
4. **Employee ID is the numbering outlier of the whole system** — a plain native Postgres sequence, never resets by year, unlike almost every other 4-digit type.
5. Management Report Pack pads to 4 digits, not 5 like its Finance siblings — likely an inconsistency, not intentional.
6. FX Revaluation Run numbers are not sequence-table-backed at all — they reuse the accounting period's own number.
7. Design Requirement numbers are not concurrency-safe and have no year segment — a simple per-project count, unlike its sibling Design Request numbers.
8. TDS Challan numbers look auto-generated but are assembled from user-supplied fields with no atomic counter behind them.

---

## Master Discrepancy Log

The most consequential, cross-cutting findings from this extraction — the ones most likely to cause real confusion for a trainee if not called out explicitly:

1. **UI buttons routinely appear for people who will get a 403 on click.** Confirmed independently in R&D/Design (Item Master/BOM), SCM (all four sub-modules), Production/Stores (Item Master, Inventory), and Accounts/Finance. The pattern is consistent: frontend "canManage" checks use a coarse `role === MANAGER/ADMIN/SUPER_ADMIN` test, while the real backend gate additionally requires a specific designation flag (`isRdHead`, `isQcInspector`) or vertical membership (SCM, PRODUCTION, ACCOUNTS). **Never train "if you see the button, you're authorized."**
2. **Two authorization systems are easy to conflate: designation flags vs. vertical membership.** See Appendix A's dedicated section. "SCM staff," "Store staff," and "HR staff" are vertical-derived, not flags — there is no `isScmStaff` boolean to grant.
3. **SUPER_ADMIN is not a universal override.** It explicitly does NOT bypass: BOM approval (`isRdHead` required), the Accounts-Head-specific approval gate (`isAccountsHead` required, no override found), or the QMS-Head/Design-Head-specific approval actions (module entry yes, Head action no). Do not assume "SUPER_ADMIN can do anything" anywhere in this system.
4. **Two separate NCR registers exist** (Stores vs. QMS) and **two separate final-QC checkpoints exist** (inbound GRN vs. outbound dispatch) — both pairs look similar enough to conflate in training material without an explicit side-by-side callout.
5. **Several "obvious" spec assumptions were checked and found not to exist in code**: the PLM Release-to-SCM Phaze-vs-vendor-SCM branching check, Order-level (as opposed to Bid-level) discount approval, PV/RV finance voucher prefixes, and a frontend UI for linking Kanban cards to PLM trackers. Where a prior spec asserted any of these, this document's code-level finding supersedes it.
6. **Several flows are silent/hidden by design, not by omission**: the Logistics-dispatch-to-invoice hand-off has no visible "Create Invoice" button anywhere; the Finance credit-control override screen is deliberately excluded from the nav; BOM/PLM notifications sometimes don't deep-link on click. These are current, intentional (or at least confirmed-current) behaviors, not bugs to "fix" in training material — but they should be called out explicitly since the absence of a button is easy to mistake for a missing feature.
7. **Single-holder designation flags** (`isSalesHead`, `isAccountsHead`, `isQmsHead`, `isDesignHead`) are enforced only at the application layer via an atomic unset-then-set transaction — there is no database-level constraint preventing two holders, so this depends entirely on no other code path ever writing that boolean directly (confirmed true today via repo-wide search, but worth re-verifying if this document is reused after future code changes).
