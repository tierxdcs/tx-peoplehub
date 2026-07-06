import {
  BidStatus,
  Lead,
  LeadPriority,
  Opportunity,
  OrderStatus,
} from './types';

/** INR currency formatter for Decimal-as-string amounts. */
const inr = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  maximumFractionDigits: 2,
});

/** Format a Decimal-as-string (or number) money value as INR. '—' if empty. */
export function formatINR(value: string | number | null | undefined): string {
  if (value === null || value === undefined || value === '') return '—';
  const n = typeof value === 'number' ? value : Number(value);
  if (Number.isNaN(n)) return String(value);
  return inr.format(n);
}

/**
 * Blended pipeline display status for the Lead Register (spec §2.2): a
 * lead shows its own status until it's CONVERTED, after which it shows the
 * linked Opportunity's stage — a UI-layer concatenation over the two
 * separate backend entities. Kept as one helper so every screen renders
 * the same label rather than duplicating the branch inline.
 */
export function leadDisplayStatus(
  lead: Pick<Lead, 'status' | 'convertedToOpportunityId'>,
  opportunity?: Pick<Opportunity, 'stage'> | null,
): string {
  if (lead.status === 'CONVERTED' && opportunity) {
    return prettyEnum(opportunity.stage);
  }
  return prettyEnum(lead.status);
}

/** ENUM_LIKE_THIS → "Enum Like This". */
export function prettyEnum(value: string): string {
  return value
    .toLowerCase()
    .split('_')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

/** Inline style for a small status/priority pill. */
export function badgeStyle(background: string): React.CSSProperties {
  return {
    display: 'inline-block',
    padding: '2px 8px',
    borderRadius: 10,
    fontSize: 12,
    fontWeight: 600,
    color: '#fff',
    background,
  };
}

/** Priority badge color (spec §2.2: High red, Medium orange, Low neutral). */
export function priorityColor(p: LeadPriority): string {
  switch (p) {
    case 'HIGH':
      return '#c0392b';
    case 'MEDIUM':
      return '#e67e22';
    case 'LOW':
      return '#7f8c8d';
  }
}

/** Neutral-to-green-ish color for a blended lead/opportunity display status. */
export function pipelineStatusColor(displayStatus: string): string {
  const s = displayStatus.toLowerCase();
  if (s.includes('won')) return '#27ae60';
  if (s.includes('lost') || s.includes('disqualified')) return '#c0392b';
  if (s.includes('qualified') || s.includes('proposal') || s.includes('negotiation'))
    return '#2980b9';
  return '#7f8c8d'; // New / Contacted / Prospecting / etc.
}

export function bidStatusColor(status: BidStatus): string {
  switch (status) {
    case 'ACCEPTED':
      return '#27ae60';
    case 'APPROVED':
    case 'SENT':
      return '#2980b9';
    case 'PENDING_APPROVAL':
      return '#e67e22';
    case 'REJECTED':
    case 'EXPIRED':
      return '#c0392b';
    case 'DRAFT':
    default:
      return '#7f8c8d';
  }
}

export function orderStatusColor(status: OrderStatus): string {
  switch (status) {
    case 'DELIVERED':
      return '#27ae60';
    case 'CANCELLED':
      return '#c0392b';
    case 'CONFIRMED':
      return '#7f8c8d';
    default:
      return '#2980b9'; // in-flight states
  }
}

/** Legal forward order-status transitions (mirrors OrdersService). */
export const ORDER_NEXT_STATUSES: Record<OrderStatus, OrderStatus[]> = {
  CONFIRMED: ['IN_PRODUCTION', 'CANCELLED'],
  IN_PRODUCTION: ['READY_TO_SHIP', 'CANCELLED'],
  READY_TO_SHIP: ['SHIPPED', 'CANCELLED'],
  SHIPPED: ['DELIVERED', 'CANCELLED'],
  DELIVERED: [],
  CANCELLED: [],
};
