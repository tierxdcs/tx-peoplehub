# Signal UI — the app-wide design standard and conversion playbook

"Signal" is the design language introduced with the dashboard redesign
(Aug 2026) and rolled out module by module. This document is the durable
contract for continuing the rollout — a fresh session or a new contributor
should be able to convert a module from this file alone.

## Where the standard lives

| What | Where |
|---|---|
| Primitives + style guide | `web/app/components/ui/signal.tsx` (the doc comment is normative) |
| Register/list exemplar | `web/app/(protected)/sales/orders/page.tsx` |
| Form/detail exemplar (aligned table + sticky rail) | `web/app/(protected)/stores/purchase-orders/new/page.tsx` |
| Analytics exemplar | `web/app/(protected)/dashboard/page.tsx` |
| Theme plumbing (`data-signal-page` vars, main-column paint) | `web/app/globals.css` (bottom) |

## The language in one paragraph

Full-bleed page surfaces on the app grey ramp (`#F4F4F4` light / `#1B1B1B`
dark); white / `#232323` cards separated by hairline borders; the app blue
`#3B6FB5` for primary actions and links (`#6FA3E0` in dark); orange `#E08A2C`
strictly for warning/at-risk meaning; green/red for success/danger. App font
everywhere except the dashboard quote; numeric columns align with
`tabular-nums`, never a mono face. Depth comes from surface steps and
hairlines — no shadows. Empty states are one plain muted sentence, never an
illustration. Every page works in BOTH themes.

## Conversion recipe (per page)

1. Read `signal.tsx` and the two page exemplars first. They are binding.
2. Scaffold: `PageContainer`/`PageHeader` → `SignalPage` + `SignalHeader`
   (title, description, actions; detail pages get `backHref`/`backLabel`
   replacing hand-rolled breadcrumbs; status badges go in the `chip` slot).
   Wrap content in `<div className="space-y-4 px-5 pb-7 pt-[18px] lg:px-7">`,
   or the form exemplar's `xl:grid-cols-[1fr_316px]` grid with an
   `xl:sticky xl:top-[4.5rem]` rail when the page has natural summary data.
3. Surfaces: `Card/CardHeader/CardTitle/CardContent` → `SCard` (+
   `SCardTitle`). Local stat-card components → `StatStrip` + `StatTile`.
   Tables go full-bleed inside `SCard className="overflow-hidden"`.
4. Line-item editors: convert to the aligned-table pattern (one shared grid
   template for the header row + body rows, `SIGNAL_TABLE_HEAD`, numbered
   rows, right-aligned `tabular-nums`, per-row remove, dashed add-button in a
   footer strip) — only when the mapping is clean; otherwise keep structure.
5. Form actions (Cancel / primary submit) move into the header via
   `SIGNAL_BTN_GHOST` / `SIGNAL_BTN_PRIMARY`. If the submit button leaves the
   `<form>`, give the form an id and use the native `form=` attribute so the
   exact submit path and native validation keep firing.
6. Dialogs on converted pages: `className={SIGNAL_DIALOG}` on DialogContent,
   `SIGNAL_DIALOG_TITLE` on DialogTitle, footer buttons → the Signal button
   constants.
7. Warnings/notices: hand-rolled orange/red boxes → `Callout`
   (`warning`/`danger`). Timelines → `RouteStep`. Chips → `ToneChip`.

## Hard rules

- **Presentational only.** Never change data fetching, handlers, routing,
  permissions, validation, or user-facing copy. Behavior is byte-identical.
- **Keep semantic components** as-is: Button, Badge, StatusBadge, Input,
  Select, Field, Textarea, Table*, RegisterToolbar, RegisterPagination,
  Skeleton, EmptyState, dialogs, toasts, pickers. They are theme-aware and
  render correctly on Signal surfaces.
- **Both themes, always.** Custom colors must be light-first with a `dark:`
  pair, exactly like the exemplars. Never an unpaired `white/...` alpha or a
  dark-only hex. Colors that live in inline styles (charts) use the
  `--sd-*` CSS variables from globals.css.
- **When a section doesn't map cleanly, leave it** functionally identical
  with minimal styling rather than restructuring.
- Loading / error / forbidden branches also get re-hosted on `SignalPage`
  (same copy, same skeletons).

## Verification per module

`cd web && npx tsc --noEmit && npm run build && npx vitest run`, plus an
audit for unpaired tokens:
`grep -rn "white/" <pages> | grep -v "dark:"` should return nothing.

## Rollout status

- ✅ Dashboard (option 2a of the design handoff)
- ✅ Stores: New Purchase Order (option 3a)
- ✅ Sales Pipeline — all 14 pages (leads, opportunities + BOM intake, bids
  incl. new/detail/approval queues, orders incl. new/detail, confirmation
  sheets) + the leads dialogs
- ✅ People (HR) — Roster, Onboard Employee wizard, Offer Letters register,
  Offer Letter approval queue + review detail
- ✅ Payroll — Payroll Runs register + run detail + payslip detail, Statutory
  Config, Salary Structures (dialogs included)
- ✅ Finance Vouchers — Day Book, Sales Vouchers register + invoice detail,
  Purchase Vouchers, Receipts, Payments, Credit & Debit Notes, Journals,
  Contra, Expense Claims, and the shared VoucherShell (covers all six
  voucher-entry forms). Convention set here: voucher/document numbers use the
  app font + tabular-nums, not a mono face. VoucherShell has two layouts:
  compact (one centred card — Receipt, Payment, Contra, Journal, Purchase) and
  wide, enabled by passing `summary`, which switches to the form exemplar
  (`[1fr_316px]` grid, sticky totals rail, actions in the header, `sections` as
  full-bleed cards). Sales Voucher uses wide because it has a real line-item
  table — stacked "Item N" sub-cards inside the compact card read as clutter.
- ✅ Leave & Attendance (admin) — Leave Approvals queue, Attendance Corrections.
  NOTE: /leave, /attendance, /team/leave-approvals, /team/attendance are thin
  routes around dual-mode `_sections/*` components that also render as profile
  tabs — converting those requires a dedicated pass on the section components
  (they must keep working embedded), deliberately not done yet.
- ⬜ Sales Master Data (Customer Master) · stores/SCM rest · kanban/my-tasks ·
  finance · QMS · design · HR rest (leave, payroll, admin) — convert module by
  module using this playbook. Signature screens with novel layouts (Kanban
  board, PLM tracker detail) may warrant a design pass first; everything else
  does not.
