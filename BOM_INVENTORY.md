# Bill of Materials, Item Master & Stock Availability (MVP)

R&D prepares revision-controlled Bills of Materials for a Product; an **R&D
Head** technically approves them. At **Project Kickoff**, the released BOM for
each ordered product is snapshotted and compared against store inventory to
produce a **material stock-availability report**.

This document is the source of truth for the domain model, workflow, permissions,
formulas, and endpoints. It complements (does not replace) the code.

---

## 1. Domain model

New Prisma models (migrations `20260718130000_bom_inventory` +
`20260718140000_bom_item_keying_and_hardgate`):

| Model | Table | Purpose |
|---|---|---|
| `Item` | `items` | Item Master — BOM lines & stock reference items here, never free-text names |
| `Bom` | `boms` | One BOM revision (header) **for an `Item`** (see keying note) |
| `BomLine` | `bom_lines` | One child-item line on a revision |
| `BomEvent` | `bom_events` | Immutable workflow/approval history per BOM |
| `ItemSupplier` | `item_suppliers` | Links an Item to a Supplier — informational only, not a release gate |
| `StoreLocation` | `store_locations` | Physical store/warehouse |
| `StockBalance` | `stock_balances` | On-hand / reserved / blocked per item+location |
| `StockAdjustment` | `stock_adjustments` | Append-only stock movement history |
| `StockReservation` | `stock_reservations` | Material earmarked for a kickoff |
| `KickoffStockReport` | `kickoff_stock_reports` | One snapshotted report per kickoff |
| `KickoffBomSelection` | `kickoff_bom_selections` | Which released BOM was chosen per ordered product |
| `KickoffBomSnapshotLine` | `kickoff_bom_snapshot_lines` | Copied EXPLODED leaf requirements (historical accuracy) |

New enums: `ItemType` (RAW_MATERIAL, COMPONENT, SUBASSEMBLY, FINISHED_GOOD,
CONSUMABLE), `BomStatus` (DRAFT, PENDING_APPROVAL, REJECTED, RELEASED, OBSOLETE),
`BomLineSource` (MAKE, BUY), `BomEventType`, `StockBucket` (ON_HAND, BLOCKED),
`SupplierFilledBy` (pre-existing). `NotificationType` gains `BOM_SUBMITTED`,
`BOM_APPROVED`, `BOM_REJECTED`; `Notification` gains `relatedBomId`.

`Employee` gains `isRdHead Boolean @default(false)`.

### BOM is keyed on Item, not Product (multi-level from the start)
`Bom.itemId → Item` with `@@unique([itemId, revisionNumber])`. A sellable
`Product` carries a nullable `Product.itemId` bridge to its manufactured
(typically FINISHED_GOOD) Item. This keying is what enables **genuine
multi-level explosion**: a SUBASSEMBLY/COMPONENT Item that is never sold as a
Product still has its own BOM, so an order line resolves
`product → item → released BOM → recursive explosion → raw-material leaves`.

Existing models touched only additively: `Product.itemId` (nullable bridge),
`ProjectKickoff.stockReport` + `stockReservations`, `Notification.relatedBomId`,
`Employee.isRdHead`, `Supplier.itemLinks`, `Item.boms`/`products`/`supplierLinks`
+ back-relations.

### Decimal precision
- Quantities: `Decimal(14,4)` (finer than money's `14,2` — per-unit BOM quantities
  are often fractional).
- Percentages: `Decimal(5,2)`.
- All requirement math rounds to **4 decimal places, ROUND_HALF_UP** (see
  `src/modules/bom/stock-calc.ts`; recorded on each report as `quantityPrecision`).
- Decimals are serialized to **strings** in API responses (repo convention).

---

## 2. R&D approval workflow

```
DRAFT ──submit──► PENDING_APPROVAL ──approve──► RELEASED
   ▲                     │
   │                     └──reject (comment)──► REJECTED ──edit──► DRAFT ──submit──► …
   │
RELEASED ──new-revision──► (new) DRAFT       RELEASED ──(a newer revision released)──► OBSOLETE
```

- Editing a **DRAFT** or **REJECTED** BOM is allowed; a rejected BOM edited
  returns to DRAFT until resubmitted.
- **Released BOMs are immutable.** To change one, create a new revision
  (`POST /boms/:id/new-revision`) which copies the lines into a fresh DRAFT.
- When a revision is **released**, any previously-RELEASED revision of the same
  **item** is set to **OBSOLETE in the same transaction**.
- **Supplier qualification is informational, not a release gate.** Linking an
  Item to a Supplier in `APPROVED`/`APPROVED_PREFERRED` status is optional and
  has no effect on whether a BOM can be approved/released. Release only runs
  the cycle check (§5).
- Every transition writes a `BomEvent` and (submit/approve/reject) a
  `Notification`; all mutations are also captured by the global `AuditInterceptor`.

---

## 3. Permission matrix

| Action | Who |
|---|---|
| Designate/revoke R&D Head | ADMIN, SUPER_ADMIN — **target must be in the R&D vertical** |
| Read items / inventory | R&D vertical, Store (Production vertical), or SUPER_ADMIN |
| Browse the BOM (Engineering) module | **R&D vertical only** (or SUPER_ADMIN) — Store users do NOT get the BOM pages |
| Create/update items (technical data) | **R&D Head** or SUPER_ADMIN |
| Link/unlink item↔supplier (informational only) | **R&D Head** or SUPER_ADMIN |
| Create/edit/submit BOM drafts | **R&D vertical** employee (or SUPER_ADMIN) |
| Approve/reject a submitted BOM | **R&D Head only** — *SUPER_ADMIN is NOT sufficient* |
| Adjust stock / reserve / cancel reservations | Store (Production vertical) or SUPER_ADMIN |
| Generate/read stock report | R&D or Store or SUPER_ADMIN (reads the released BOM indirectly) |

Notes:
- **SUPER_ADMIN can manage the R&D Head designation but does not gain BOM
  approval authority** — approval requires a real `isRdHead` holder (spec §1).
- **An R&D Head cannot approve/reject a BOM they created** — another R&D Head must.
- Rejection requires a **non-empty comment**.
- Enforcement is in `BomAccessService` at the service layer, not only in the UI.

### Store access decision (documented per spec §2/§6)
The repo has **no dedicated Store capability flag or vertical**. Per the "smallest
consistent access rule" instruction, the existing **`PRODUCTION` vertical is
treated as the Store team** for inventory management. If a real Store role is
introduced later, only `BomAccessService.isStoreStaff/assertCanManageInventory`
need to change.

---

## 4. Inventory quantity definitions

- `onHandQuantity` — physically in the store.
- `reservedQuantity` — earmarked by reservations (moved only via reservations, never adjusted directly).
- `blockedQuantity` — quarantined/rejected stock.
- **`availableQuantity = onHandQuantity − reservedQuantity − blockedQuantity`** —
  **derived on read, never stored** as an editable value.
- `expectedReceiptQuantity` / `expectedReceiptDate` — optional inbound-supply visibility.

Stock adjustments (`POST /inventory/adjustments`) apply a **signed delta** to a
bucket (`ON_HAND` or `BLOCKED`), inside a transaction that re-reads the row and
**rejects any change that would make on-hand, blocked, or available negative**.
Every adjustment writes a `StockAdjustment` history row (actor, reason, delta,
bucket, timestamp). Reservations are transactional and audited.

---

## 5. Multi-level explosion, requirement & availability formulas (report)

### Multi-level explosion (`src/modules/bom/bom-explosion.ts`)
When a report is generated, each ordered product's Item is exploded **recursively**
through its released BOM tree down to **leaf** items (a leaf = an item with no
released BOM of its own — raw materials, bought components). A component that has
its own released BOM is expanded further, not flattened. Per-level quantities
multiply and **wastage compounds multiplicatively** at each level. Only the
resulting leaves are snapshotted and reported; intermediate assemblies are not
listed as requirements.

**Cycle & depth safety:** the explosion tracks the ancestor path and throws
`BomCycleError` on any revisit (A→B→A, A→A, A→B→C→A) — a clear error, never a
hang. A hard `MAX_EXPLOSION_DEPTH = 25` backstops pathological chains
(`BomDepthError`). A BOM line may not reference the item the BOM is for
(rejected at create/edit), and **release runs the same cycle check** over the
would-be-released tree (`assertNoReleaseCycle`), so a cycle can never enter the
released set.

### Requirement math
Per exploded leaf, `quantityPerTopUnit` already folds in compounded wastage; the
snapshot stores the pure `basePerTopUnit` and an **effective compounded wastage %**
= `(gross/base − 1)·100`, so the report reproduces:

```
baseRequirement  = leaf.basePerTopUnit × orderedProductQuantity
wastageQuantity  = baseRequirement × (effectiveWastagePercent / 100)
grossRequirement = baseRequirement + wastageQuantity
```

Identical leaf `Item` records are **aggregated across all order lines, products,
and every level of every BOM** before comparison with stock. Live stock is summed
across all locations for the item.

```
available          = Σ onHand − Σ reserved − Σ blocked          (across locations)
reservedForKickoff = Σ active reservations for THIS kickoff
effectiveAvailable = available + reservedForKickoff             (avoid double-counting §9)
```

Availability status:

| Status | Meaning |
|---|---|
| `AVAILABLE` | `effectiveAvailable ≥ grossRequirement` |
| `EXPECTED_BEFORE_REQUIRED_DATE` | insufficient now, but expected receipts cover the deficit and arrive in time |
| `SHORTAGE` | insufficient current + timely expected stock |
| `UNKNOWN` | no stock record for the item (inventory/mapping incomplete) |

"In time": the MVP has no explicit required-by date on the kickoff, so any
**future-dated** expected receipt counts as timely. The report returns per-item
rows + `summary` counts (available / expected / shortage / unknown / totalItems),
and both `reservedRequiredQuantity` and `unreservedRequiredQuantity`.

The report **identifies shortages but never blocks kickoff creation**.

---

## 6. Kickoff snapshot behavior

- The report is **snapshotted the first time it is generated**: the selected
  RELEASED BOM revision (id + number) and a copy of its lines are persisted.
- Generation **validates that at least one released BOM exists** for the order's
  products, else 400.
- **Re-reading recomputes live availability against the snapshotted requirements**
  — never against the current/mutable BOM.
- A later BOM revision being released **does not change an existing snapshot**
  (verified by e2e). Generation is idempotent — calling generate again returns
  the existing snapshot rather than re-snapshotting.

---

## 7. Reservations (§9)

- A reservation references the **kickoff + item + store location**.
- Reservations **cannot exceed available stock** unless `allowOverride: true`
  (the explicit override convention).
- Creating/cancelling is **transactional**: it increments/decrements
  `StockBalance.reservedQuantity` atomically and flips the reservation's
  `isActive`, with actor + timestamp captured.
- Re-running the report **accounts for this kickoff's own reservations without
  double-counting** (via `effectiveAvailable`).

---

## 8. New endpoints

```
# Item Master
GET    /items                 (search, activeOnly)      read: R&D/Store
POST   /items                                            R&D Head
GET    /items/:id                                        read: R&D/Store
PATCH  /items/:id                                        R&D Head
DELETE /items/:id             (deactivate — no hard delete) R&D Head

# Item ↔ Supplier links (informational only, not a release gate)
GET    /items/:itemId/suppliers                          read: R&D/Store
POST   /items/:itemId/suppliers  { supplierId, ... }     R&D Head
DELETE /items/:itemId/suppliers/:linkId                  R&D Head

# BOM (keyed on Item)
GET    /boms                  (itemId, status)           R&D only
POST   /boms                  { itemId, lines, ... }     R&D vertical
GET    /boms/pending-approval                            R&D Head (approval queue)
GET    /boms/:id                                         R&D only
PATCH  /boms/:id              (DRAFT/REJECTED only)      R&D vertical
POST   /boms/:id/submit                                  R&D vertical
POST   /boms/:id/approve      (cycle check)              R&D Head (not creator)
POST   /boms/:id/reject       { comment }                R&D Head (not creator)
POST   /boms/:id/new-revision                            R&D vertical
GET    /items/:itemId/boms                               R&D only

# Inventory
GET    /inventory             (search, storeLocationId)  read: R&D/Store
GET    /inventory/stores                                 read: R&D/Store
POST   /inventory/adjustments                            Store
GET    /inventory/items/:itemId                          read: R&D/Store
GET    /inventory/items/:itemId/adjustments              read: R&D/Store

# Kickoff stock availability + reservations
POST   /project-kickoffs/:id/stock-availability/generate read: R&D/Store (snapshots)
GET    /project-kickoffs/:id/stock-availability          read: R&D/Store (null if none)
GET    /project-kickoffs/:id/reservations                read: R&D/Store
POST   /project-kickoffs/:id/reservations                Store
DELETE /project-kickoffs/:id/reservations/:reservationId Store

# Employee capability
PATCH  /employees/:id/designate-rd-head                  ADMIN/SUPER_ADMIN (target in R&D)
PATCH  /employees/:id/revoke-rd-head                     ADMIN/SUPER_ADMIN
```

All responses use the standard `{ success, data }` envelope; errors use the
global exception filter. Mutations are audited by the global `AuditInterceptor`.

---

## 9. Migration & deployment notes

- Migration `20260718130000_bom_inventory` is **additive only**: new enums,
  tables, and nullable/defaulted columns (`employees.isRdHead DEFAULT false`,
  `notifications.relatedBomId` nullable). No destructive steps; existing
  production data is preserved. Apply with `prisma migrate deploy`.
- Seed (`prisma/seed.ts`) idempotently upserts a default store location
  (`MAIN` — "Main Store") so the inventory feature has a location to hold
  balances. Safe to re-run.
- The `NotificationType` enum values are added with separate `ALTER TYPE … ADD
  VALUE` statements (Postgres requirement).
- The pre-existing SQL hotfix (`prisma/hotfix-kanban-phase5-prod.sql`) is untouched.

---

## 10. Frontend

- Nav is split by vertical:
  - **Engineering** group (R&D vertical / SUPER_ADMIN only): **Bills of
    Materials**; plus **BOM Approvals** shown only to R&D Heads. Gated by
    `useIsRndStaff()`; backend `assertCanBrowseBoms` enforces it.
  - **Store Management** group (Store = PRODUCTION vertical / SUPER_ADMIN):
    **Item Master**, **Inventory**. Gated by `useIsStoreStaff()`.
- Pages: `/scm/items`, `/scm/bom` (+ `/new`, `/[id]`, `/[id]/edit`,
  `/pending-approval`), `/scm/inventory`. Kickoff detail gains a
  **Material Stock Availability** section (generate/regenerate, per-item table
  with status badges, summary counts, and reserve/cancel controls).
- R&D Head badge + designate/revoke controls in Admin → Employees, mirroring the
  Internal Auditor pattern (R&D-vertical-gated). Capability flag is fetched via
  `useIsRndHead()` (not in the JWT).

---

## 11. Explicit MVP exclusions

- **Automatic purchase requisitions / purchase orders / procurement.**
- The kickoff stock report identifies shortages but does **not** block kickoff
  creation. Supplier qualification is likewise informational only — it does not
  gate BOM release, production release, or dispatch.
- A full warehouse-management system (bins, lots, cycle counts, multi-UoM
  conversion) — inventory here is a focused MVP.
- An explicit customer "required-by" date driving the EXPECTED classification
  (any future-dated receipt is treated as timely).
- BOM cost rollups.
