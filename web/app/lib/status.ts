import type { BadgeVariant } from '../components/ui/badge';

/**
 * ONE place that maps every status / priority / role enum in the app to a
 * Badge variant, so a given semantic (e.g. "approved/won/active" → green)
 * looks identical everywhere it appears — Employee accessStatus, Leave
 * status, Lead priority, Bid status, Order status, etc. Pages call
 * `statusVariant(value)` and render `<Badge variant={...}>` rather than
 * hardcoding colors per page.
 *
 * The map is keyed by the raw enum string; unknown values fall back to a
 * neutral 'muted' badge (never throws), so a new backend enum value degrades
 * gracefully instead of crashing the UI.
 */
const VARIANT_BY_VALUE: Record<string, BadgeVariant> = {
  // ---- positive / terminal-good ----
  ACTIVE: 'success',
  APPROVED: 'success',
  ACCEPTED: 'success',
  COMPLETED: 'success',
  CLOSED_WON: 'success',
  CLOSED: 'success',
  DELIVERED: 'success',
  PAID: 'success',
  QUALIFIED: 'success',
  PRESENT: 'success',

  // ---- in-progress / neutral-active (blue) ----
  SENT: 'info',
  CONTACTED: 'info',
  PROPOSAL: 'info',
  NEGOTIATION: 'info',
  QUALIFICATION: 'info',
  PROSPECTING: 'info',
  CONFIRMED: 'info',
  IN_PRODUCTION: 'info',
  READY_TO_SHIP: 'info',
  SHIPPED: 'info',
  PROCESSING: 'info',
  GENERATED: 'info',
  ON_LEAVE: 'info',
  IN_PROGRESS: 'info',
  IMPACT_ASSESSMENT: 'info',
  IMPLEMENTING: 'info',
  SCHEDULED: 'info',
  ACKNOWLEDGED: 'success',
  EXECUTED: 'success',
  USE_AS_IS: 'success',
  NOT_APPLICABLE: 'muted',
  SUPERSEDED: 'muted',
  REWORK: 'warning',
  SCRAP: 'destructive',
  RETURN_TO_VENDOR: 'warning',
  HOLD: 'warning',
  MITIGATED: 'info',
  DONE: 'success',
  // Vendor qualification statuses.
  PENDING_QUESTIONNAIRE: 'info',
  QUESTIONNAIRE_SUBMITTED: 'info',
  UNDER_AUDIT: 'info',
  APPROVED_PREFERRED: 'success',
  CONDITIONALLY_APPROVED: 'warning',
  NOT_APPROVED: 'destructive',

  // BOM statuses (DRAFT/PENDING_APPROVAL/REJECTED already mapped below).
  RELEASED: 'success',
  OBSOLETE: 'muted',

  // Stock-availability statuses.
  AVAILABLE: 'success',
  EXPECTED_BEFORE_REQUIRED_DATE: 'info',
  SHORTAGE: 'destructive',
  UNKNOWN: 'muted',

  // Stores — Purchase Order statuses (DRAFT/CANCELLED mapped below/above).
  ISSUED: 'info',
  PARTIALLY_RECEIVED: 'info',
  FULLY_RECEIVED: 'success',

  // Stores — GRN + QC statuses. PENDING_QC is caution; a partial pass is a
  // warning (something was rejected); full fail is red.
  PENDING_QC: 'warning',
  QC_PASSED: 'success',
  QC_PARTIAL: 'warning',
  QC_FAILED: 'destructive',

  // Stores — NCR statuses (OPEN mapped below as amber).
  DISPOSITIONED: 'info',

  // Stores — Material Indent statuses (OPEN/CANCELLED shared).
  PARTIALLY_ISSUED: 'info',
  FULLY_ISSUED: 'success',

  // RFQ Builder — RFQ status (DRAFT/ISSUED/CLOSED/CANCELLED shared) + award.
  AWARDED: 'success',
  // RFQ per-invitee quote status.
  INVITED: 'muted',
  VIEWED: 'info',
  SUBMITTED: 'success',
  DECLINED: 'destructive',

  // Logistics & Dispatch — Delivery Challan statuses.
  DISPATCHED: 'info',
  IN_TRANSIT: 'info',
  // (DELIVERED already mapped success above.)
  // Order fulfilment (derived) + final-QC clearance.
  PARTIALLY_DISPATCHED: 'info',
  FULLY_DISPATCHED: 'success',
  CLEARED: 'success',

  // ---- pending / caution (amber) ----
  PENDING: 'warning',
  PENDING_APPROVAL: 'warning',
  // Two-stage approval gates (candidate requisitions + offer letters): both the
  // vertical-owner and the CEO/super-admin stages are "awaiting a decision".
  PENDING_VERTICAL_APPROVAL: 'warning',
  PENDING_SUPERADMIN_APPROVAL: 'warning',
  PENDING_CSCO_APPROVAL: 'warning',
  PENDING_COO_APPROVAL: 'warning',
  PENDING_CEO_APPROVAL: 'warning',
  WAITING: 'muted',
  PENDING_CLOSURE: 'warning',
  AWAITING_INTERNAL_SIGNATURE: 'warning',
  AWAITING_CUSTOMER_SIGNATURE: 'warning',
  PENDING_ACCESS: 'warning',
  DRAFT: 'warning',
  NEW: 'warning',
  HALF_DAY: 'warning',
  EXPIRED: 'warning',
  LOCKED: 'warning',
  TODO: 'warning',
  DELAYED: 'warning',
  OPEN: 'warning',

  // ---- negative / terminal-bad (red) ----
  INACTIVE: 'destructive',
  REJECTED: 'destructive',
  DISQUALIFIED: 'destructive',
  CLOSED_LOST: 'destructive',
  CANCELLED: 'destructive',
  ABSENT: 'destructive',

  // ---- priority ----
  HIGH: 'destructive',
  MEDIUM: 'warning',
  LOW: 'muted',

  // ---- roles ----
  SUPER_ADMIN: 'default',
  ADMIN: 'default',
  MANAGER: 'info',
  EMPLOYEE: 'muted',
};

/** Badge variant for any status/priority/role enum value. */
export function statusVariant(value: string | null | undefined): BadgeVariant {
  if (!value) return 'muted';
  return VARIANT_BY_VALUE[value] ?? 'muted';
}

/** Enum tokens that read as acronyms, not Title Case (e.g. PENDING_CEO_APPROVAL
 *  → "Pending CEO Approval" rather than "Pending Ceo Approval"). */
const ACRONYMS: Record<string, string> = { ceo: 'CEO', kpi: 'KPI', ctc: 'CTC' };

/** ENUM_LIKE_THIS → "Enum Like This" for display. */
export function humanizeEnum(value: string): string {
  return value
    .toLowerCase()
    .split('_')
    .map((w) => ACRONYMS[w] ?? w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

/**
 * Human label for a Role enum. The SUPER_ADMIN role is presented to users as
 * "CEO" (the internal enum value is unchanged); every other role falls back to
 * the generic enum humanizer. Use this anywhere a role is rendered.
 */
export function roleLabel(role: string | null | undefined): string {
  if (!role) return '';
  if (role === 'SUPER_ADMIN') return 'CEO';
  return humanizeEnum(role);
}
