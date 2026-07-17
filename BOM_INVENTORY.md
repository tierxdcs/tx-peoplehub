# Bill of Materials, Item Master & Stock Availability (MVP)

R&D prepares revision-controlled Bills of Materials for a Product; an **R&D
Head** technically approves them. At **Project Kickoff**, the released BOM for
each ordered product is snapshotted and compared against store inventory to
produce a **material stock-availability report**.

This document is the source of truth for the domain model, workflow, permissions,
formulas, and endpoints. It complements (does not replace) the code.

---

## 1. Domain model

New Prisma models (migration `20260718130000_bom_inventory`):

| Model | Table | Purpose |
|---|---|---|
| `Item` | `items` | Item Master — BOM lines & stock reference items here, never free-text names |
| `Bom` | `boms` | One BOM revision (header) for a `Product` |
| `BomLine` | `bom_lines` | One material line on a revision |
| `BomEvent` | `bom_events` | Immutable workflow/approval history per BOM |
| `StoreLocation` | `store_locations` | Physical store/warehouse |
| `StockBalance` | `stock_balances` | On-hand / reserved / blocked per item+location |
| `StockAdjustment` | `stock_adjustments` | Append-only stock movement history |
| `StockReservation` | `stock_reservations` | Material earmarked for a kickoff |
| `KickoffStockReport` | `kickoff_stock_reports` | One snapshotted report per kickoff |
| `KickoffBomSelection` | `kickoff_bom_selections` | Which released BOM was chosen per ordered product |
| `KickoffBomSnapshotLine` | `kickoff_bom_snapshot_lines` | Copied BOM lines (historical accuracy) |

New enums: `ItemType` (RAW_MATERIAL, COMPONENT, SUBASSEMBLY, FINISHED_GOOD,
CONSUMABLE), `BomStatus` (DRAFT, PENDING_APPROVAL, REJECTED, RELEASED, OBSOLETE),
`BomLineSource` (MAKE, BUY), `BomEventType`, `StockBucket` (ON_HAND, BLOCKED),
`SupplierFilledBy` (pre-existing). `NotificationType` gains `BOM_SUBMITTED`,
`BOM_APPROVED`, `BOM_REJECTED`; `Notification` gains `relatedBomId`.

`Employee` gains `isRdHead Boolean @default(false)`.

Existing models touched only additively: `Product.boms`, `ProjectKickoff.stockReport`
+ `stockReservations`, `Notification.relatedBomId`, `Employee.isRdHead` + back-relations.

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
  product is set to **OBSOLETE in the same transaction**.
- Every transition writes a `BomEvent` and (submit/approve/reject) a
  `Notification`; all mutations are also captured by the global `AuditInterceptor`.

---

## 3. Permission matrix

| Action | Who |
|---|---|
| Designate/revoke R&D Head | ADMIN, SUPER_ADMIN — **target must be in the R&D vertical** |
| Read items / BOMs / inventory | R&D vertical, Store (Production vertical), or SUPER_ADMIN |
| Create/update items (technical data) | **R&D Head** or SUPER_ADMIN |
| Create/edit/submit BOM drafts | **R&D vertical** employee (or SUPER_ADMIN) |
| Approve/reject a submitted BOM | **R&D Head only** — *SUPER_ADMIN is NOT sufficient* |
| Adjust stock / reserve / cancel reservations | Store (Production vertical) or SUPER_ADMIN |
| Generate/read stock report | anyone who can read BOMs |

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

## 5. Requirement & availability formulas (report)

For each BOM snapshot line against each ordered product line:

```
baseRequirement  = bomLine.quantityPerUnit × orderedProductQuantity
wastageQuantity  = baseRequirement × (wastagePercent / 100)
grossRequirement = baseRequirement + wastageQuantity
```

Identical `Item` records are **aggregated across all order lines / BOMs** before
comparison with stock. Live stock is summed across all locations for the item.

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

# BOM
GET    /boms                  (productId, status)        read: R&D/Store
POST   /boms                                             R&D vertical
GET    /boms/pending-approval                            R&D Head (approval queue)
GET    /boms/:id                                         read: R&D/Store
PATCH  /boms/:id              (DRAFT/REJECTED only)      R&D vertical
POST   /boms/:id/submit                                  R&D vertical
POST   /boms/:id/approve                                 R&D Head (not creator)
POST   /boms/:id/reject       { comment }                R&D Head (not creator)
POST   /boms/:id/new-revision                            R&D vertical
GET    /products/:productId/boms                         read: R&D/Store

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

- Nav "Engineering" group (company-wide read): **Item Master**, **Bills of
  Materials**, **Inventory**; plus **BOM Approvals** shown only to R&D Heads.
- Pages: `/scm/items`, `/scm/bom` (+ `/new`, `/[id]`, `/[id]/edit`,
  `/pending-approval`), `/scm/inventory`. Kickoff detail gains a
  **Material Stock Availability** section (generate/regenerate, per-item table
  with status badges, summary counts, and reserve/cancel controls).
- R&D Head badge + designate/revoke controls in Admin → Employees, mirroring the
  Internal Auditor pattern (R&D-vertical-gated). Capability flag is fetched via
  `useIsRndHead()` (not in the JWT).

---

## 11. Explicit MVP exclusions

- **The hard BOM-release gate that blocks production release for unqualified
  materials** — the report identifies shortages but does not block.
- **Automatic purchase requisitions / purchase orders / procurement.**
- A full warehouse-management system (bins, lots, cycle counts, multi-UoM
  conversion) — inventory here is a focused MVP.
- An explicit customer "required-by" date driving the EXPECTED classification
  (any future-dated receipt is treated as timely).
- BOM cost rollups.
