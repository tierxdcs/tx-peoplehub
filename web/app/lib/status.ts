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

  // ---- pending / caution (amber) ----
  PENDING: 'warning',
  PENDING_APPROVAL: 'warning',
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

/** ENUM_LIKE_THIS → "Enum Like This" for display. */
export function humanizeEnum(value: string): string {
  return value
    .toLowerCase()
    .split('_')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}
