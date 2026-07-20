/**
 * Static, hardcoded end-to-end process overviews per vertical (spec §6). These
 * change rarely, so they live here as a plain data array — a one-file edit to
 * update, no admin machinery. Each step has a short label, one line of detail,
 * and a `gate` flag marking approval / QC / sign-off points (where people get
 * blocked and most need to understand why).
 *
 * ALSO the source of truth for the live per-record flow indicators (§7): the
 * `RECORD_FLOWS` below define the step sequence for each workflow entity, and
 * the `*Stage` helpers derive the CURRENT step from a record's actual status —
 * never a stored "current step" field.
 */

export interface FlowStep {
  key: string;
  label: string;
  detail: string;
  gate?: boolean;
}

export interface VerticalFlow {
  /** Vertical codes this flow applies to (matches Vertical.code). */
  codes: string[];
  title: string;
  steps: FlowStep[];
}

export const VERTICAL_FLOWS: VerticalFlow[] = [
  {
    codes: ['SALES'],
    title: 'Sales — Lead to Order',
    steps: [
      { key: 'lead', label: 'Lead', detail: 'A new prospect enters the pipeline.' },
      { key: 'qualify', label: 'Qualify', detail: 'Assess fit and intent.' },
      { key: 'opportunity', label: 'Opportunity', detail: 'A qualified deal being worked.' },
      { key: 'assessment', label: 'Bid/No-Bid', detail: 'Sales Head approves whether to bid.', gate: true },
      { key: 'bid', label: 'Bid', detail: 'Priced proposal prepared for the customer.' },
      { key: 'discount', label: 'Discount approval', detail: 'Required when the discount exceeds 10%.', gate: true },
      { key: 'accepted', label: 'Customer accepts', detail: 'The customer agrees to the bid.' },
      { key: 'order', label: 'Order', detail: 'Bid converts to a confirmed order.' },
      { key: 'ocs', label: 'Confirmation Sheet', detail: 'Customer signs; Sales Head countersigns.', gate: true },
      { key: 'released', label: 'Released to production', detail: 'Handed off to the production floor.' },
    ],
  },
  {
    codes: ['RND', 'DESIGN'],
    title: 'R&D / Design — BOM to Release',
    steps: [
      { key: 'item', label: 'Item Master', detail: 'Items and technical data defined.' },
      { key: 'draft', label: 'BOM drafted', detail: 'A multi-level bill of materials is built.' },
      { key: 'submitted', label: 'BOM submitted', detail: 'Sent for technical approval.' },
      { key: 'approved', label: 'R&D Head approves', detail: 'Only a designated R&D Head can approve.', gate: true },
      { key: 'released', label: 'BOM released', detail: 'Locked and versioned.' },
      { key: 'available', label: 'Available for production', detail: 'Drives stock explosion and manufacturing.' },
    ],
  },
  {
    codes: ['SCM'],
    title: 'SCM — Need to Purchase Order',
    steps: [
      { key: 'need', label: 'Material need', detail: 'Identified from a kickoff shortfall or manually.' },
      { key: 'rfq', label: 'RFQ', detail: 'Floated to 3 or more suppliers/vendors.' },
      { key: 'quotes', label: 'Sealed quotes', detail: 'Quotes stay hidden until the RFQ closes.' },
      { key: 'compare', label: 'Comparison', detail: 'Quotes compared side by side.' },
      { key: 'award', label: 'Award', detail: 'Justification required if not the lowest.', gate: true },
      { key: 'po', label: 'Purchase Order', detail: 'A DRAFT PO is pre-filled from the award.' },
      { key: 'received', label: 'Goods received', detail: 'A GRN records the incoming material.' },
    ],
  },
  {
    codes: ['PRODUCTION'],
    title: 'Production / Stores — Receipt to Dispatch',
    steps: [
      { key: 'po', label: 'PO issued', detail: 'A purchase order is placed on a supplier.' },
      { key: 'grn', label: 'GRN on receipt', detail: 'Goods recorded — no stock yet.' },
      { key: 'qc', label: 'QC inspection', detail: 'Incoming quality gate.', gate: true },
      { key: 'stock', label: 'Stock / NCR', detail: 'Accepted qty enters stock; rejected raises an NCR.' },
      { key: 'indent', label: 'Material indent', detail: 'Production requests material.' },
      { key: 'issue', label: 'Material issued', detail: 'Reservation-aware issue from stores.' },
      { key: 'manufacture', label: 'Manufacturing', detail: 'The work order is built.' },
      { key: 'finalqc', label: 'Final QC', detail: 'Finished goods cleared before shipping.', gate: true },
      { key: 'dispatch', label: 'Dispatch', detail: 'Delivery challan; stock leaves; draft invoice raised.' },
    ],
  },
  {
    codes: ['QUALITY', 'QMS'],
    title: 'Quality — Incoming to Final',
    steps: [
      { key: 'incoming', label: 'Incoming QC', detail: 'Inspect material received on a GRN.', gate: true },
      { key: 'ncr', label: 'Accept / reject', detail: 'Rejections raise an NCR for disposition.' },
      { key: 'inprocess', label: 'In-process checks', detail: 'Checks during manufacturing.' },
      { key: 'final', label: 'Final QC clearance', detail: 'Required before dispatch.', gate: true },
    ],
  },
  {
    codes: ['ACCOUNTS'],
    title: 'Accounts — Invoice to Receipt',
    steps: [
      { key: 'draft', label: 'Draft invoice', detail: 'Dispatch seeds a DRAFT sales invoice.' },
      { key: 'submit', label: 'Finance submits', detail: 'Finance reviews and submits it.' },
      { key: 'approve', label: 'Accounts Head approves', detail: 'The sole approver signs off.', gate: true },
      { key: 'issued', label: 'Issued & posted', detail: 'Invoice issued and posted to the GL.' },
      { key: 'receipt', label: 'Customer receipt', detail: 'Payment recorded when it arrives.' },
      { key: 'allocated', label: 'Allocated', detail: 'Receipt applied against the invoice.' },
    ],
  },
  {
    codes: ['HR'],
    title: 'HR — Onboarding to Payroll',
    steps: [
      { key: 'onboard', label: 'Onboarding', detail: 'Personnel record created.' },
      { key: 'access', label: 'Access granted', detail: 'Role and login assigned.', gate: true },
      { key: 'leave', label: 'Leave & attendance', detail: 'Day-to-day people operations.' },
      { key: 'payroll', label: 'Payroll', detail: 'Monthly salary processing.' },
    ],
  },
];

/** Pick the flow overview for a vertical code (null if none / no vertical). */
export function flowForVertical(code: string | null | undefined): VerticalFlow | null {
  if (!code) return null;
  return VERTICAL_FLOWS.find((f) => f.codes.includes(code)) ?? null;
}
