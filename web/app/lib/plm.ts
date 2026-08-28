import { apiFetch } from './api';

/**
 * Fixed sheet-metal fabrication routing reported during PRODUCTION — mirrors
 * PLM_PRODUCTION_STEPS on the backend. A progress update's `completedSteps`
 * counts how many are done (in order); percent = completedSteps / length.
 */
export const PLM_PRODUCTION_STEPS = [
  'Material',
  'Cut',
  'Punch',
  'Bend',
  'Weld',
  'Powder Coating',
  'Assemble',
  'QC',
  'Pack',
] as const;

export type PlmStage =
  | 'DESIGN'
  | 'DESIGN_REVIEW'
  | 'DRAWING_RELEASE'
  | 'RELEASE_TO_SCM'
  | 'MATERIAL_PLANNING'
  | 'PRODUCTION'
  | 'QC'
  | 'DISPATCH'
  | 'COMPLETED';

/**
 * Canonical PLM stage labels — the single source of truth for how a stage is
 * named to humans. Kept in sync with PLM_STAGE_LABEL in the backend
 * customer-order-progress.service.ts so staff (internal PLM strip) and
 * customers (order portal) see identical stage names.
 */
export const PLM_STAGE_LABEL: Record<PlmStage, string> = {
  DESIGN: 'Design',
  DESIGN_REVIEW: 'Design Review',
  DRAWING_RELEASE: 'Drawing Release',
  RELEASE_TO_SCM: 'Release to SCM',
  MATERIAL_PLANNING: 'Material Planning',
  PRODUCTION: 'Production',
  QC: 'QC',
  DISPATCH: 'Dispatch',
  COMPLETED: 'Completed',
};

/** Stage sequence for New Product Development lines (full 9-stage flow). */
export const NPD_STAGES: PlmStage[] = [
  'DESIGN',
  'DESIGN_REVIEW',
  'DRAWING_RELEASE',
  'RELEASE_TO_SCM',
  'MATERIAL_PLANNING',
  'PRODUCTION',
  'QC',
  'DISPATCH',
  'COMPLETED',
];

/** Stage sequence for in-house / vendor lines (6-stage flow). */
export const STANDARD_STAGES: PlmStage[] = [
  'RELEASE_TO_SCM',
  'MATERIAL_PLANNING',
  'PRODUCTION',
  'QC',
  'DISPATCH',
  'COMPLETED',
];

export interface PlmTracker {
  id: string;
  orderLineId: string;
  orderId: string;
  flowType: 'NPD' | 'IN_HOUSE' | 'VENDOR';
  currentStage: PlmStage;
  status: 'ACTIVE' | 'COMPLETED';
  ownerId: string;
  owner: { id: string; firstName: string; lastName: string };
  vendor: { id: string; companyName: string } | null;
  kickoff: {
    supplyInScope: boolean;
    vendorUpdateCadenceDays: number;
  };
  designReviewStatus: 'NOT_SUBMITTED' | 'PENDING' | 'APPROVED' | 'REJECTED';
  designSubmittedById: string | null;
  designReviewComment: string | null;
  orderLine: {
    id: string;
    quantity: string;
    /** Customer's own PO wording for this line, when Sales set one. */
    customerFacingProductName: string | null;
    product: { id: string; name: string; sku: string };
  };
  events: Array<{
    id: string;
    type: string;
    comment: string | null;
    createdAt: string;
    actor: { firstName: string; lastName: string } | null;
  }>;
  productionUpdates: Array<{
    id: string;
    updateType: 'FULL_PROGRESS' | 'COMMENT_ONLY';
    reporterType: 'VENDOR_SELF_REPORT' | 'INTERNAL_AUDITOR_VISIT';
    reporterDisplayName: string;
    /** Count of completed routing steps (0..9); null for comment-only / legacy. */
    completedSteps: number | null;
    /** Legacy free-form percentages — present only on historical updates. */
    fabricationPercent: number | null;
    surfaceFinishPercent: number | null;
    assemblyPercent: number | null;
    notes: string | null;
    createdAt: string;
    photos: Array<{ id: string; fileName: string; sizeBytes: number }>;
  }>;
  derived: {
    /** Design project matched on (orderId, productId) — NPD trackers only.
     * Null on an NPD tracker means no design project is linked. */
    designProject: {
      id: string;
      projectNumber: string;
      name: string;
      status: string;
    } | null;
    drawingReleased: boolean;
    qcPassed: boolean;
    dispatched: boolean;
    production: { done: number; total: number };
    lastVendorUpdateAt: string | null;
    vendorCadence: {
      status: 'GREEN' | 'AMBER' | 'RED';
      cadenceDays: number;
      dueAt: string;
      lastVendorUpdateAt: string | null;
    } | null;
  };
}

export interface PlmVendorInvite {
  id: string;
  token: string;
  expiresAt: string;
  revokedAt: string | null;
  createdAt: string;
  createdBy: { firstName: string; lastName: string };
}

export interface PlmDashboardItem {
  trackerId: string;
  orderId: string;
  orderNumber: string;
  customerName: string | null;
  productName: string;
  productSku: string;
  flowType: 'NPD' | 'IN_HOUSE' | 'VENDOR';
  currentStage: PlmStage;
  ownerName: string;
  ageDays: number;
  promisedDeliveryDate: string | null;
  daysUntilDue: number | null;
  blocker: string | null;
  health: 'ON_TRACK' | 'AT_RISK' | 'BLOCKED';
  /**
   * Who is actually executing this line. Derived on the server from the delivery
   * flow, so it is correct even when the split carries no vendor name:
   * IN_HOUSE work is our own facility, NPD with no vendor is our own
   * development, and everything else is a genuine external vendor.
   */
  facilityKind: 'IN_HOUSE' | 'IN_HOUSE_NPD' | 'EXTERNAL_VENDOR';
  /** Bold-able label: the vendor's own name, or "In-House — Balaji MetalTech". */
  facilityLabel: string;
  /** Vendor Master id when a real vendor row backs the label, else null. */
  facilityVendorId: string | null;
  /** The portion of the order line this tracker covers, as a fixed-2 string. */
  splitQuantity: string;
  /** The tracker's own vendor-update cadence verdict; null when none is running. */
  vendorCadenceStatus: 'GREEN' | 'AMBER' | 'RED' | null;
  /**
   * When the next self-report is due and when the last one actually arrived, so a
   * consumer can say "quiet since Tuesday" rather than only "overdue". Both null
   * whenever no cadence is running on this tracker.
   */
  vendorCadenceDueAt: string | null;
  lastVendorUpdateAt: string | null;
  production: { done: number; total: number };
  hasPendingPing: boolean;
  updatedAt: string;
}

export const getMyPlmWork = () =>
  apiFetch<PlmDashboardItem[]>('/plm/dashboard');

export const getOrderPlm = (orderId: string) =>
  apiFetch<PlmTracker[]>(`/plm/orders/${orderId}`);

export const getPlmTracker = (trackerId: string) =>
  apiFetch<PlmTracker>(`/plm/trackers/${trackerId}`);

export const plmTrackerHref = (trackerId: string) =>
  `/plm/trackers/${encodeURIComponent(trackerId)}`;

export const plmAction = (trackerId: string, action: string, body?: unknown) =>
  apiFetch(`/plm/trackers/${trackerId}/${action}`, {
    method: 'POST',
    ...(body ? { body: JSON.stringify(body) } : {}),
  });

export const getPlmInvites = (trackerId: string) =>
  apiFetch<PlmVendorInvite[]>(`/plm/trackers/${trackerId}/vendor-invites`);

export const createPlmInvite = (trackerId: string, password?: string) =>
  apiFetch<PlmVendorInvite>(`/plm/trackers/${trackerId}/vendor-invites`, {
    method: 'POST',
    body: JSON.stringify({ password: password || undefined }),
  });
