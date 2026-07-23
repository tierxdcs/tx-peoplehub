/**
 * Live per-record flow definitions (spec §7). Each workflow entity gets a fixed
 * ordered list of steps plus a mapper that derives the CURRENT stage from the
 * record's ACTUAL status/state — there is no stored "current step" field. Dead
 * records (rejected / cancelled / expired) return `cancelled: true` so the
 * indicator shows a terminal banner instead of a misleading progress strip.
 *
 * These pair with the <ProcessFlow> component: pass `steps`, `currentStage`,
 * and `cancelled` straight through.
 */
import type { ProcessFlowStep } from '../components/ui/process-flow';
import type { BidStatus, OrderStatus } from './types';
import type { PurchaseOrderStatus } from './stores';
import type { RfqStatus } from './rfq';
import type { VendorStatus } from './scm';
import type { SupplierStatus } from './scm-supplier';

export interface FlowResult {
  steps: ProcessFlowStep[];
  currentStage: string | null;
  completed?: boolean;
  cancelled: boolean;
  cancelledLabel?: string;
}

// ── Bid: assessment → approval → sent → accepted ─────────────────────
const BID_STEPS: ProcessFlowStep[] = [
  { key: 'draft', label: 'Drafted', next: 'Submit for approval.' },
  { key: 'pending', label: 'Pending approval', gate: true, next: 'Awaiting Sales Head approval.' },
  { key: 'approved', label: 'Approved', gate: true, next: 'Send the bid to the customer.' },
  { key: 'sent', label: 'Sent', next: 'Awaiting the customer’s decision.' },
  { key: 'accepted', label: 'Accepted', next: 'Convert to an order.' },
];

export function bidFlow(status: BidStatus): FlowResult {
  if (status === 'REJECTED')
    return { steps: BID_STEPS, currentStage: null, cancelled: true, cancelledLabel: 'This bid was rejected in approval.' };
  if (status === 'EXPIRED')
    return { steps: BID_STEPS, currentStage: null, cancelled: true, cancelledLabel: 'This bid expired before acceptance.' };
  const map: Record<Exclude<BidStatus, 'REJECTED' | 'EXPIRED'>, string> = {
    DRAFT: 'draft',
    PENDING_APPROVAL: 'pending',
    APPROVED: 'approved',
    SENT: 'sent',
    ACCEPTED: 'accepted',
  };
  return { steps: BID_STEPS, currentStage: map[status], cancelled: false };
}

// ── Order: confirmed → in production → ready → shipped → delivered ────
const ORDER_STEPS: ProcessFlowStep[] = [
  { key: 'confirmed', label: 'Confirmed', next: 'Release to production.' },
  { key: 'production', label: 'In production', next: 'Build and finish the order.' },
  { key: 'ready', label: 'Ready to ship', gate: true, next: 'Final QC cleared; dispatch it.' },
  { key: 'shipped', label: 'Shipped', next: 'In transit to the customer.' },
  { key: 'delivered', label: 'Delivered', next: 'Order fulfilled.' },
];

export function orderFlow(status: OrderStatus): FlowResult {
  if (status === 'CANCELLED')
    return { steps: ORDER_STEPS, currentStage: null, cancelled: true, cancelledLabel: 'This order was cancelled.' };
  const map: Record<Exclude<OrderStatus, 'CANCELLED'>, string> = {
    CONFIRMED: 'confirmed',
    IN_PRODUCTION: 'production',
    READY_TO_SHIP: 'ready',
    SHIPPED: 'shipped',
    DELIVERED: 'delivered',
  };
  return { steps: ORDER_STEPS, currentStage: map[status], cancelled: false };
}

// ── Purchase Order: draft → issued → partially/fully received ────────
const PO_STEPS: ProcessFlowStep[] = [
  { key: 'draft', label: 'Draft', next: 'Issue the PO to the supplier.' },
  { key: 'issued', label: 'Issued', next: 'Awaiting goods receipt.' },
  { key: 'partial', label: 'Partially received', next: 'Some lines received; awaiting the rest.' },
  { key: 'full', label: 'Fully received', next: 'All goods received.' },
];

export function poFlow(status: PurchaseOrderStatus): FlowResult {
  if (status === 'CANCELLED')
    return { steps: PO_STEPS, currentStage: null, cancelled: true, cancelledLabel: 'This purchase order was cancelled.' };
  const map: Record<Exclude<PurchaseOrderStatus, 'CANCELLED'>, string> = {
    DRAFT: 'draft',
    ISSUED: 'issued',
    PARTIALLY_RECEIVED: 'partial',
    FULLY_RECEIVED: 'full',
  };
  return { steps: PO_STEPS, currentStage: map[status], cancelled: false };
}

// ── RFQ: draft → issued → closed → awarded (→ PO created) ────────────
const RFQ_STEPS: ProcessFlowStep[] = [
  { key: 'draft', label: 'Draft', next: 'Issue the RFQ to invitees.' },
  { key: 'issued', label: 'Issued', next: 'Collecting sealed quotes.' },
  { key: 'closed', label: 'Closed', gate: true, next: 'Compare quotes and award.' },
  { key: 'awarded', label: 'Awarded', next: 'A draft PO is pre-filled from the award.' },
];

export function rfqFlow(status: RfqStatus): FlowResult {
  if (status === 'CANCELLED')
    return { steps: RFQ_STEPS, currentStage: null, cancelled: true, cancelledLabel: 'This RFQ was cancelled.' };
  const map: Record<Exclude<RfqStatus, 'CANCELLED'>, string> = {
    DRAFT: 'draft',
    ISSUED: 'issued',
    CLOSED: 'closed',
    AWARDED: 'awarded',
  };
  return { steps: RFQ_STEPS, currentStage: map[status], cancelled: false };
}

// ── Vendor / Supplier qualification (shared shape) ───────────────────
const QUALIFICATION_STEPS: ProcessFlowStep[] = [
  { key: 'questionnaire', label: 'Questionnaire sent', next: 'Awaiting the questionnaire response.' },
  { key: 'submitted', label: 'Submitted', next: 'Schedule the audit.' },
  { key: 'audit', label: 'Under audit', gate: true, next: 'Audit in progress; scoring to follow.' },
  { key: 'classified', label: 'Classified', gate: true, next: 'Qualification decision recorded.' },
];

function qualificationStage(status: VendorStatus | SupplierStatus): string {
  switch (status) {
    case 'PENDING_QUESTIONNAIRE':
      return 'questionnaire';
    case 'QUESTIONNAIRE_SUBMITTED':
      return 'submitted';
    case 'UNDER_AUDIT':
      return 'audit';
    default:
      // Any terminal classification (approved / conditional / not approved).
      return 'classified';
  }
}

export function vendorFlow(status: VendorStatus): FlowResult {
  return { steps: QUALIFICATION_STEPS, currentStage: qualificationStage(status), cancelled: false };
}

export function supplierFlow(status: SupplierStatus): FlowResult {
  return { steps: QUALIFICATION_STEPS, currentStage: qualificationStage(status), cancelled: false };
}

// ── Project Kickoff: created → attendees → action items → completed ──
const KICKOFF_STEPS: ProcessFlowStep[] = [
  { key: 'created', label: 'Created', next: 'Add attendees to the kickoff.' },
  { key: 'attendees', label: 'Attendees added', next: 'Assign action items.' },
  { key: 'actions', label: 'Action items assigned', next: 'Work the plan to completion.' },
  { key: 'completed', label: 'Completed', next: 'Kickoff finalised.' },
];

export function kickoffFlow(input: {
  status: 'DRAFT' | 'COMPLETED';
  attendeeCount: number;
  actionItemCount: number;
}): FlowResult {
  // Derive from actual state, not a stored step. Completed always wins.
  let stage = 'created';
  if (input.status === 'COMPLETED') stage = 'completed';
  else if (input.actionItemCount > 0) stage = 'actions';
  else if (input.attendeeCount > 0) stage = 'attendees';
  return {
    steps: KICKOFF_STEPS,
    currentStage: stage,
    completed: input.status === 'COMPLETED',
    cancelled: false,
  };
}
