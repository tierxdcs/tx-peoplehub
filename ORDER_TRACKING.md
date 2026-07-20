# Order Progress Tracking & Health Monitoring

Status: **spec / not yet built**
Owner: dashboard + cross-vertical workflow
Related: personal dashboard (`web/app/(protected)/dashboard`), `ProcessFlow` component, `record-flows.ts`

---

## 1. What this is

A per-order **progress track** (Order → Dispatch, traffic-light style) plus a
separate, computed **health signal** (green / amber / red), shown on the
dashboard of everyone involved in that order's project.

Two independent signals, deliberately:

- **Progress** — *where* the work is. Which stage the order has reached. Derived
  from real system state, never a stored "current step".
- **Health** — *whether it's in trouble*. Progress state compared against the
  committed delivery date. An order can be far along and still red (promised
  tomorrow, still in procurement); an order can be at an early stage and green
  (plenty of runway).

The reference is a horizontal traffic-light stage strip. We already have the
visual: the `<ProcessFlow>` component built for the per-record indicators. This
feature extends that pattern with (a) an order-spanning stage set that crosses
verticals, and (b) a health tint.

---

## 2. The core design principle (and the reality check)

The original premise was "nine of ten stages are already provably derivable
from existing state, so no human has to remember to flag anything." **I verified
this against the schema. It is _mostly_ true, with two real gaps that the spec
must handle honestly rather than assume away.**

Verified against `prisma/schema.prisma`:

| # | Stage | Real signal | Derivable today? |
|---|-------|-------------|------------------|
| 1 | Order confirmed | `Order.status = CONFIRMED` (schema:1018, enum:171) | ✅ hard |
| 2 | Requirements signed | `OrderConfirmationSheet.status = EXECUTED`, linked by `orderId` (schema:1146, 1143) | ✅ hard |
| 3 | Kickoff done | a `ProjectKickoff` exists for the order (`ProjectKickoff.orderId`, schema:2390) | ✅ hard |
| 4 | Engineering released | the kickoff's BOM selections are all `RELEASED` (`Bom.status`, schema:2937; reached via `ProjectKickoff → KickoffBomSelection → Bom`) | ✅ derivable (via kickoff) |
| 5 | **Procurement** | PO exists / `FULLY_RECEIVED` for this order | ❌ **GAP — see §3** |
| 6 | Material issued | `MaterialIndent.projectKickoffId` → issues (schema:5741, nullable) | ⚠️ only when the (optional) link is set |
| 7 | **Production** | no Production module exists | ⚠️ **use Kanban — see §4** |
| 8 | Final QC | `Order.finalQcStatus = CLEARED` (schema:1022, enum:1058) | ✅ hard |
| 9 | Dispatch | `DeliveryChallan.status = DISPATCHED`, linked by `orderId` (schema:5827, enum:5815) | ✅ hard |
| 10 | Invoiced | `SalesInvoice.status = ISSUED`, `orderId` (schema:4438, 4426, nullable) | ✅ derivable |

So: **7 of 10 are hard/derivable today. Two need a small fix (5, 6), and one
(7) is the Kanban story we already agreed on.** The handover-flag idea is
correctly rejected — but we cannot pretend procurement is derivable when it
structurally isn't. Fixing the linkage (below) is cheaper and more honest than a
manual flag, and it stays true to the "real state, nothing to remember"
principle.

---

## 3. Required schema change: link procurement to the project

**The gap:** `PurchaseOrder` links only to a supplier/vendor. It has **no**
`orderId`, `projectId`, or `kickoffId` (verified: schema:3521–3556). `GRN` links
only to a PO (schema:4818), so it inherits the gap. There is no way, today, to
tell which project a PO or GRN serves. Stage 5 is therefore not derivable.

This is not a dashboard problem to paper over — it's a missing FK. The SCM
process itself already says material need is "identified from a kickoff
shortfall," so the origin is known at PO-creation time; we just don't persist
it.

**Fix (minimal, additive):**

```prisma
model PurchaseOrder {
  // ...
  projectKickoffId String?        // set when the PO originates from a kickoff shortfall
  projectKickoff   ProjectKickoff? @relation(fields: [projectKickoffId], references: [id], onDelete: SetNull)
  @@index([projectKickoffId])
}
```

- **Nullable**, because ad-hoc/stock POs legitimately have no project.
- Populate it when a PO is raised from the kickoff shortfall flow (pre-fill the
  field the same way the draft PO is already pre-filled from an RFQ award).
- Stage 5 (Procurement) then derives as: *for this project's kickoff, do any
  linked POs exist? are they all `FULLY_RECEIVED`?* — real state, nothing to
  remember.

**Stage 6 (Material issued)** already has `MaterialIndent.projectKickoffId`
(schema:5741) — but it's nullable and easy to leave blank. Make the material-
indent flow **default that link** when the indent is raised from a project
context (mirror of the PO fix), so material issues attribute to the project
without anyone remembering.

If we choose *not* to do the PO fix now, the spec degrades cleanly: stages 5–6
render as "not tracked" rather than showing false progress. That's the fallback,
not the goal.

---

## 4. Production stage & the Kanban vertical tag

No Production module exists, so manufacturing progress comes from the project's
Kanban board — real state (someone moved a card because they did the work).

**Decision (settled): tag the vertical on the _card_, not the list.** A per-list
tag would force one column per vertical and destroy the To Do / In Progress /
Done workflow. A per-card tag keeps the board's normal columns and gives
per-vertical completion for free.

**Schema change:**

```prisma
model KanbanCard {
  // ...
  verticalId String?
  vertical   Vertical? @relation(fields: [verticalId], references: [id], onDelete: SetNull)
  @@index([verticalId])
}
```

- **Nullable / optional.** Not every card belongs to a vertical.
- **Auto-fills from the assignee's vertical** on assignment (the assignee's
  `Employee.verticalId`), editable in the card modal
  (`web/app/(protected)/kanban/_components/card-modal.tsx`, alongside the
  existing `assigneeId` / `dueDate` patch fields). So it's usually correct
  without anyone touching it.

**Per-vertical completion** (computed from the board's cards, done vs total by
tag):

> Design 4/4 · SCM 2/3 · Production 2/7 · Quality 0/2

- "Done" = card sits in a list where `isDoneList = true` (schema:2182).
- Board is reached via `card.listId → KanbanList.boardId` (there is no direct
  `boardId` on the card — verified schema:2232).
- The project's board is `ProjectKickoff.kanbanBoardId` (schema:2401).

**Production stage progress** specifically = cards tagged **Production**, done /
total on the project board. Stage 7 is "done" when that ratio hits 100% (and, as
a backstop, when `Order.status` has advanced past `IN_PRODUCTION`).

---

## 5. The stage model (order-spanning)

Ten stages, each with its derivation. This is a new flow definition alongside
the existing `record-flows.ts` (which does single records); this one spans an
order. Suggested `web/app/lib/order-flow.ts`:

| Stage | Key | Done when |
|-------|-----|-----------|
| Confirmed | `confirmed` | `Order.status ∈ {CONFIRMED, …}` (i.e. the order exists and isn't cancelled) |
| Requirements signed | `ocs` | order's OCS `status = EXECUTED` |
| Kickoff | `kickoff` | a `ProjectKickoff` row exists for the order |
| Engineering | `engineering` | all of the kickoff's BOM selections are `RELEASED` (or none required) |
| Procurement | `procurement` | POs linked to the kickoff exist and are all `FULLY_RECEIVED` (needs §3) |
| Material issued | `material` | material indent(s) for the kickoff are `FULLY_ISSUED` |
| Production | `production` | Production-tagged cards on the project board 100% in a done list |
| Final QC | `qc` | `Order.finalQcStatus = CLEARED` |
| Dispatch | `dispatch` | a `DeliveryChallan` for the order is `DISPATCHED` (or `Order.fulfilmentStatus = FULLY_DISPATCHED`) |
| Invoiced | `invoiced` | a `SalesInvoice` for the order is `ISSUED` |

**Current stage = the furthest stage whose "done" predicate is true, +1** (the
next not-done stage is "active"). Cancellation (`Order.status = CANCELLED`) is a
terminal banner, exactly like the existing `ProcessFlow` `cancelled` state.

Stages 5–6, if the linkage fix isn't in, render as **"not tracked"** (a distinct
muted state, not "done" and not "active") so the strip never lies.

---

## 6. Health signal (green / amber / red)

Health is a **separate computation** that compares progress against the
committed delivery date. The date anchor is **`OrderConfirmationSheet.deliveryDate`**
(schema:1150) — the customer-signed date on the executed sheet. (`Order` itself
has no promised-delivery field; verified. The OCS date is actually the better
anchor: it's the contractually committed date, not an internal guess.)

**Automatic rule** (dates compared to *state*, never dates alone):

- 🟢 **Green** — on track. Either no committed date yet, or the current stage is
  consistent with time remaining (see the per-stage expected-by map below), or
  the order is already dispatched/delivered.
- 🟡 **Amber** — at risk. The committed date is within a warning window
  (e.g. ≤ N days out) **and** the order has not yet reached a late-stage
  milestone (Final QC cleared / dispatched). Tune N per how long dispatch+QC
  realistically takes.
- 🔴 **Red** — off track. The committed delivery date has **passed** and the
  order is not yet dispatched; **or** a hard checkpoint is provably behind
  (e.g. committed date within X days but still sitting in Procurement or
  earlier).

The key property: *"promised in 3 days but still at Procurement"* is red because
we're comparing the **committed date against the actual stage**, and an order
that's genuinely dispatched is **not** red just because some interim date
slipped.

> Implementation note: keep the stage→"should be reached by" mapping as a simple
> table (fraction of the confirmed→delivery window each stage should be complete
> by). Health = worst of {date-vs-current-stage checks}. Keep it a pure function
> of the order's derived state + the OCS date so it recomputes live and is unit-
> testable, mirroring `quoteOfTheDay` / `record-flows` determinism.

### PM override (settled: yes, with mandatory reason)

A PM can override computed health when they know something the system can't
(e.g. the customer agreed to the slip). Store the override, never mutate the
computed value:

```prisma
model ProjectKickoff {
  // ...
  healthOverride       ProjectHealth?  // GREEN | AMBER | RED, null = use computed
  healthOverrideReason String?         // REQUIRED when healthOverride is set
  healthOverrideById   String?
  healthOverrideBy     Employee?       @relation(...)
  healthOverrideAt     DateTime?
}
enum ProjectHealth { GREEN AMBER RED }
```

- Attach the override to the **`ProjectKickoff`** (one per order; it's the
  natural project home and already carries the board + attendees).
- Reason is **mandatory** — enforced in the DTO (`@IsNotEmpty` when
  `healthOverride` present) and in the UI.
- The dashboard shows the overridden colour **with an indicator that it's a
  manual override** and the reason on hover/expand — so an amber-overridden-green
  never silently hides a real problem. Only the PM (and SUPER_ADMIN) can set it.

---

## 7. Who sees a given project (audience)

Settled audience: **kickoff attendees + order owner + PM + anyone assigned a card
on the project board.** Union of:

1. `ProjectKickoff.attendees[].employeeId` (internal attendees).
2. `ProjectKickoff.createdById` (the PM who created it).
3. `Order.ownerId` (schema:1040) — the order owner.
4. Distinct `assigneeId` of cards on `ProjectKickoff.kanbanBoardId`.

**Backend** computes this set and exposes a `GET /project-kickoffs/my-tracked`
(or fold into a dashboard aggregate) returning, for each project the caller is
in that union: order number + customer, the ten stage states, current stage,
per-vertical completion, computed health, and any override. Access is enforced
server-side (a caller only ever gets projects they're in the union for) —
consistent with how kickoff access is already gated.

**A dashboard section** ("My projects" — reintroduced in this richer form, since
the plain version was removed as not-useful; *this* version is useful because it
shows live cross-vertical progress + health, not just a name). Each row: a
compact traffic-light stage strip + a health dot + per-vertical mini-summary,
linking to the kickoff / order. Degrades gracefully: someone in no projects
doesn't see the section.

---

## 8. What to build (phased)

**Phase A — Kanban vertical tag (independently useful):**
1. `KanbanCard.verticalId` (nullable) + migration + `@@index`.
2. Auto-fill from assignee's vertical on assign; expose in card-modal + card
   entity/DTO.
3. Per-vertical completion helper (cards done/total by tag on a board).

**Phase B — Procurement/material linkage (the honesty fix):**
4. `PurchaseOrder.projectKickoffId` (nullable) + migration; populate from the
   kickoff-shortfall PO flow.
5. Default `MaterialIndent.projectKickoffId` from project context.

**Phase C — Order flow + health:**
6. `web/app/lib/order-flow.ts`: the 10-stage derivation + `orderHealth()` pure
   fn (state + OCS date → GREEN/AMBER/RED). Unit-tested like `record-flows`.
7. Backend aggregate endpoint (stages + health + per-vertical + audience
   filtering).
8. `ProjectKickoff` health-override fields + `ProjectHealth` enum + PM-only
   PATCH with mandatory reason.

**Phase D — Dashboard surface:**
9. Reintroduce a richer "My projects" section: traffic-light stage strip
   (extend `<ProcessFlow>` with a health tint + "not tracked" state) + health
   dot + per-vertical summary + override indicator.
10. Order/kickoff detail page: full-width version of the same strip.

**Verification:** stage derivation from real state only (no stored current
step); health = state-vs-date not date-alone (unit tests for the "promised soon
but early stage → red" and "dispatched but date passed → green" cases);
override requires a reason and never overwrites computed value; audience
filtering enforced server-side; "not tracked" renders when linkage absent; FE
typecheck/test/build + click-through as PM and as a card-assignee.

---

## 9. Out of scope

- A full Production module (Kanban stands in until one exists).
- Auto-notifications on health change (this spec is dashboard-surfacing;
  notifications can build on the same computed signal later).
- Per-user configurable stage sets or manager rollup/portfolio views.
- Editing stage definitions from an admin UI (the stage model is code, one-file).
