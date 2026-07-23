import { apiFetch } from './api';

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
    reporterType: 'VENDOR_SELF_REPORT' | 'INTERNAL_AUDITOR_VISIT';
    reporterDisplayName: string;
    fabricationPercent: number;
    surfaceFinishPercent: number;
    assemblyPercent: number;
    notes: string | null;
    createdAt: string;
    photos: Array<{ id: string; fileName: string; sizeBytes: number }>;
  }>;
  derived: {
    drawingReleased: boolean;
    qcPassed: boolean;
    dispatched: boolean;
    production: { done: number; total: number };
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
