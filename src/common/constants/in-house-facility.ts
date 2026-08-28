/**
 * The single in-house manufacturing facility.
 *
 * IN_HOUSE work always goes here. This is a DISPLAY STRING, not a Vendor Master
 * entity: `ProjectKickoffService.resolveSplitData` writes IN_HOUSE_FACILITY_NAME
 * into `OrderLineDeliverySplit.vendorName` with `vendorId = null`, and there is
 * no Vendor row for it — so nothing can be tagged or filtered to it *as a
 * vendor*. In-house work is instead tracked through the delivery flow itself
 * (`split.deliveryType = IN_HOUSE` → `PlmTracker.flowType = IN_HOUSE` → that
 * tracker's Kanban production cards), which is what the Executive Operations
 * dashboard keys its in-house metrics on.
 *
 * Kept as named constants so relocating this to company-config later is a
 * one-file change, and so the dashboard label can never drift from the value
 * Kickoff writes.
 */

/** Full facility name, as written onto an IN_HOUSE delivery split. */
export const IN_HOUSE_FACILITY_NAME = 'Balaji MetalTech, Bengaluru';

/** Attribution label for an IN_HOUSE line — "who is executing this". */
export const IN_HOUSE_FACILITY_LABEL = 'In-House — Balaji MetalTech';

/**
 * Attribution label for an NPD line with no vendor of its own. NPD is in-house
 * engineering-led work, and is deliberately NOT folded into the in-house
 * facility's metrics: those are keyed on the IN_HOUSE flow only.
 */
export const IN_HOUSE_NPD_LABEL = 'In-House — New Product Development';

/** Shown when a VENDOR line has no vendor recorded yet — never blank. */
export const UNNAMED_VENDOR_LABEL = 'Vendor not yet named';
