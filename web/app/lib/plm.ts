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
  'Coat',
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
  productName: string;
  productSku: string;
  flowType: 'NPD' | 'IN_HOUSE' | 'VENDOR';
  currentStage: PlmStage;
  ownerName: string;
  ageDays: number;
  blocker: string | null;
  health: 'ON_TRACK' | 'AT_RISK' | 'BLOCKED';
  production: { done: number; total: number };
  updatedAt: string;
}

export const getMyPlmWork = () => apiFetch<PlmDashboardItem[]>('/plm/dashboard');

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
