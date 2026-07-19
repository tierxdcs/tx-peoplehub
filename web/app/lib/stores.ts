'use client';

import { apiFetch } from './api';

/**
 * Stores (Purchasing) client — Purchase Orders, Goods Receipt Notes + the QC
 * inspection gate, Non-Conformance Reports, and Material Indent + Issue.
 * Mirrors the backend scm-purchasing entities exactly (all Decimals are
 * serialized as strings, all dates as ISO strings). apiFetch unwraps the
 * {success,data} envelope, so these return the data payload directly.
 */

// ── Enums ────────────────────────────────────────────────────────────
export type PurchaseOrderStatus =
  | 'DRAFT'
  | 'ISSUED'
  | 'PARTIALLY_RECEIVED'
  | 'FULLY_RECEIVED'
  | 'CANCELLED';

export type GoodsReceiptNoteStatus =
  | 'DRAFT'
  | 'PENDING_QC'
  | 'QC_PASSED'
  | 'QC_PARTIAL'
  | 'QC_FAILED'
  | 'CANCELLED';

export type NonConformanceReportStatus = 'OPEN' | 'DISPOSITIONED' | 'CLOSED';

export type NcrDispositionType =
  | 'RETURN_TO_SUPPLIER'
  | 'SCRAP'
  | 'USE_AS_IS'
  | 'REWORK';

export type MaterialIndentStatus =
  | 'OPEN'
  | 'PARTIALLY_ISSUED'
  | 'FULLY_ISSUED'
  | 'CANCELLED';

export type PackingCondition = 'GOOD' | 'DAMAGED' | 'PARTIALLY_DAMAGED';

export const NCR_DISPOSITION_LABEL: Record<NcrDispositionType, string> = {
  RETURN_TO_SUPPLIER: 'Return to Supplier',
  REWORK: 'Rework',
  USE_AS_IS: 'Use as Is',
  SCRAP: 'Scrap',
};

export const PACKING_CONDITION_LABEL: Record<PackingCondition, string> = {
  GOOD: 'Good',
  DAMAGED: 'Damaged',
  PARTIALLY_DAMAGED: 'Partially Damaged',
};

// ── Purchase Orders ──────────────────────────────────────────────────
export interface PurchaseOrderLine {
  id: string;
  itemId: string;
  itemCode: string;
  itemName: string;
  orderedQuantity: string;
  unitPrice: string;
  unitOfMeasure: string;
  lineTotal: string;
  notes: string | null;
  sequence: number;
}

export interface QualificationWarning {
  partnerType: 'SUPPLIER' | 'VENDOR';
  partnerId: string;
  partnerName: string;
  status: string;
  message: string;
}

export interface PurchaseOrder {
  id: string;
  poNumber: string;
  status: PurchaseOrderStatus;
  supplierId: string | null;
  supplierName: string | null;
  vendorId: string | null;
  vendorName: string | null;
  orderDate: string;
  expectedDeliveryDate: string | null;
  notes: string | null;
  createdById: string;
  createdByName: string | null;
  issuedAt: string | null;
  cancelledAt: string | null;
  totalAmount: string;
  lines: PurchaseOrderLine[];
  qualificationWarning?: QualificationWarning | null;
  createdAt: string;
  updatedAt: string;
}

export interface PurchaseOrderLineInput {
  itemId: string;
  orderedQuantity: number;
  unitPrice: number;
  unitOfMeasure?: string;
  notes?: string;
  sequence?: number;
}

export interface CreatePurchaseOrderInput {
  supplierId?: string;
  vendorId?: string;
  orderDate?: string;
  expectedDeliveryDate?: string;
  notes?: string;
  lines: PurchaseOrderLineInput[];
}

export function listPurchaseOrders(opts: { status?: PurchaseOrderStatus } = {}) {
  const qs = opts.status ? `?status=${opts.status}` : '';
  return apiFetch<PurchaseOrder[]>(`/purchase-orders${qs}`);
}

export function getPurchaseOrder(id: string) {
  return apiFetch<PurchaseOrder>(`/purchase-orders/${id}`);
}

export function createPurchaseOrder(input: CreatePurchaseOrderInput) {
  return apiFetch<PurchaseOrder>('/purchase-orders', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export function issuePurchaseOrder(id: string) {
  return apiFetch<PurchaseOrder>(`/purchase-orders/${id}/issue`, { method: 'POST' });
}

export function cancelPurchaseOrder(id: string) {
  return apiFetch<PurchaseOrder>(`/purchase-orders/${id}/cancel`, { method: 'POST' });
}

// ── Goods Receipt Notes + QC ─────────────────────────────────────────
export interface GoodsReceiptNoteLine {
  id: string;
  purchaseOrderLineId: string;
  itemId: string;
  itemCode: string;
  itemName: string;
  storeLocationId: string;
  storeLocationName: string | null;
  orderedQuantity: string;
  receivedQuantity: string;
  acceptedQuantity: string | null;
  rejectedQuantity: string | null;
  rejectionReason: string | null;
  previouslyReceived: string;
  unitOfMeasure: string;
  sequence: number;
}

export interface OverReceiptWarning {
  purchaseOrderLineId: string;
  itemCode: string;
  orderedQuantity: string;
  cumulativeAccepted: string;
  message: string;
}

export interface GoodsReceiptNote {
  id: string;
  grnNumber: string;
  status: GoodsReceiptNoteStatus;
  purchaseOrderId: string;
  poNumber: string | null;
  receivedById: string;
  receivedByName: string | null;
  receivedDate: string;
  inspectedById: string | null;
  inspectedByName: string | null;
  inspectedAt: string | null;
  vendorDeliveryChallanNumber: string | null;
  deliveryChallanDate: string | null;
  vehicleOrAwbNumber: string | null;
  driverOrCourier: string | null;
  totalPackagesReceived: number | null;
  packingCondition: PackingCondition | null;
  supervisorSignOffId: string | null;
  supervisorSignOffName: string | null;
  notes: string | null;
  lines: GoodsReceiptNoteLine[];
  ncrs: NonConformanceReport[];
  overReceiptWarnings?: OverReceiptWarning[];
  createdAt: string;
  updatedAt: string;
}

export interface GoodsReceiptNoteLineInput {
  purchaseOrderLineId: string;
  storeLocationId: string;
  receivedQuantity: number;
  sequence?: number;
}

/** Logistics / sign-off details captured at the GRN gate (spec §3.1). */
export interface GrnLogisticsInput {
  vendorDeliveryChallanNumber?: string;
  deliveryChallanDate?: string;
  vehicleOrAwbNumber?: string;
  driverOrCourier?: string;
  totalPackagesReceived?: number;
  packingCondition?: PackingCondition;
  supervisorSignOffId?: string;
}

export interface CreateGoodsReceiptNoteInput extends GrnLogisticsInput {
  purchaseOrderId: string;
  receivedDate?: string;
  notes?: string;
  lines: GoodsReceiptNoteLineInput[];
}

export interface QcInspectionLineInput {
  grnLineId: string;
  acceptedQuantity: number;
  rejectedQuantity: number;
  rejectionReason?: string;
}

/** Lean employee result for the GRN supervisor sign-off picker. */
export interface EmployeeSearchResult {
  id: string;
  employeeId: string;
  firstName: string;
  lastName: string;
  email?: string;
}

/** Type-ahead employee search (name/email) — reused for supervisor sign-off. */
export function searchEmployees(q: string) {
  const term = q.trim();
  if (!term) return Promise.resolve<EmployeeSearchResult[]>([]);
  return apiFetch<EmployeeSearchResult[]>(
    `/employees/search?q=${encodeURIComponent(term)}`,
  );
}

export function listGrns(
  opts: { status?: GoodsReceiptNoteStatus; purchaseOrderId?: string } = {},
) {
  const params = new URLSearchParams();
  if (opts.status) params.set('status', opts.status);
  if (opts.purchaseOrderId) params.set('purchaseOrderId', opts.purchaseOrderId);
  const qs = params.toString();
  return apiFetch<GoodsReceiptNote[]>(`/goods-receipt-notes${qs ? `?${qs}` : ''}`);
}

export function getGrn(id: string) {
  return apiFetch<GoodsReceiptNote>(`/goods-receipt-notes/${id}`);
}

export function createGrn(input: CreateGoodsReceiptNoteInput) {
  return apiFetch<GoodsReceiptNote>('/goods-receipt-notes', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export function submitGrn(id: string) {
  return apiFetch<GoodsReceiptNote>(`/goods-receipt-notes/${id}/submit`, {
    method: 'POST',
  });
}

export function cancelGrn(id: string) {
  return apiFetch<GoodsReceiptNote>(`/goods-receipt-notes/${id}/cancel`, {
    method: 'POST',
  });
}

export function finalizeQc(id: string, lines: QcInspectionLineInput[]) {
  return apiFetch<GoodsReceiptNote>(`/goods-receipt-notes/${id}/finalize-qc`, {
    method: 'POST',
    body: JSON.stringify({ lines }),
  });
}

// ── Non-Conformance Reports ──────────────────────────────────────────
export interface NonConformanceReport {
  id: string;
  ncrNumber: string;
  status: NonConformanceReportStatus;
  grnId: string;
  grnNumber: string | null;
  grnLineId: string;
  itemId: string;
  itemCode: string | null;
  itemName: string | null;
  rejectedQuantity: string;
  rejectionReason: string | null;
  disposition: NcrDispositionType | null;
  dispositionNotes: string | null;
  raisedById: string;
  raisedByName: string | null;
  dispositionedById: string | null;
  dispositionedByName: string | null;
  dispositionedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export function listNcrs(
  opts: { status?: NonConformanceReportStatus; grnId?: string } = {},
) {
  const params = new URLSearchParams();
  if (opts.status) params.set('status', opts.status);
  if (opts.grnId) params.set('grnId', opts.grnId);
  const qs = params.toString();
  return apiFetch<NonConformanceReport[]>(
    `/non-conformance-reports${qs ? `?${qs}` : ''}`,
  );
}

export function getNcr(id: string) {
  return apiFetch<NonConformanceReport>(`/non-conformance-reports/${id}`);
}

export function dispositionNcr(
  id: string,
  input: { disposition: NcrDispositionType; dispositionNotes?: string },
) {
  return apiFetch<NonConformanceReport>(
    `/non-conformance-reports/${id}/disposition`,
    { method: 'POST', body: JSON.stringify(input) },
  );
}

export function closeNcr(id: string) {
  return apiFetch<NonConformanceReport>(`/non-conformance-reports/${id}/close`, {
    method: 'POST',
  });
}

// ── Material Indent + Issue ──────────────────────────────────────────
export interface MaterialIssueNote {
  id: string;
  minNumber: string;
  materialIndentId: string;
  itemId: string;
  itemCode: string | null;
  itemName: string | null;
  storeLocationId: string;
  storeLocationName: string | null;
  issuedQuantity: string;
  binLocation: string | null;
  notes: string | null;
  issuedById: string;
  issuedByName: string | null;
  issuedAt: string;
  createdAt: string;
}

export interface MaterialIndent {
  id: string;
  indentNumber: string;
  status: MaterialIndentStatus;
  projectKickoffId: string | null;
  projectName: string | null;
  itemId: string;
  itemCode: string | null;
  itemName: string | null;
  requestedQuantity: string;
  issuedQuantity: string;
  outstandingQuantity: string;
  requiredByDate: string | null;
  notes: string | null;
  raisedById: string;
  raisedByName: string | null;
  issueNotes: MaterialIssueNote[];
  createdAt: string;
  updatedAt: string;
}

export interface CreateMaterialIndentInput {
  itemId: string;
  requestedQuantity: number;
  projectKickoffId?: string;
  requiredByDate?: string;
  notes?: string;
}

export interface CreateMaterialIssueInput {
  materialIndentId: string;
  storeLocationId: string;
  issuedQuantity: number;
  binLocation?: string;
  notes?: string;
}

export function listIndents(
  opts: { status?: MaterialIndentStatus; projectKickoffId?: string } = {},
) {
  const params = new URLSearchParams();
  if (opts.status) params.set('status', opts.status);
  if (opts.projectKickoffId) params.set('projectKickoffId', opts.projectKickoffId);
  const qs = params.toString();
  return apiFetch<MaterialIndent[]>(`/material-indents${qs ? `?${qs}` : ''}`);
}

export function getIndent(id: string) {
  return apiFetch<MaterialIndent>(`/material-indents/${id}`);
}

export function createIndent(input: CreateMaterialIndentInput) {
  return apiFetch<MaterialIndent>('/material-indents', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export function cancelIndent(id: string) {
  return apiFetch<MaterialIndent>(`/material-indents/${id}/cancel`, {
    method: 'POST',
  });
}

export function listIssues(opts: { materialIndentId?: string } = {}) {
  const qs = opts.materialIndentId
    ? `?materialIndentId=${opts.materialIndentId}`
    : '';
  return apiFetch<MaterialIssueNote[]>(`/material-issue-notes${qs}`);
}

export function createIssue(input: CreateMaterialIssueInput) {
  return apiFetch<MaterialIssueNote>('/material-issue-notes', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

// ── Shared UI helpers ────────────────────────────────────────────────
/** A supplier/vendor status counts as "qualified" (no PO warning). */
export function isQualifiedStatus(status: string | null | undefined): boolean {
  return status === 'APPROVED' || status === 'APPROVED_PREFERRED';
}

/**
 * The GRN pipeline stages, in order, for the flow indicator. Each GRN's status
 * maps to exactly one active stage (or a terminal off-pipeline state).
 */
export type GrnFlowStage = 'RECEIVED' | 'QC' | 'STOCK';

export function grnFlowStage(status: GoodsReceiptNoteStatus): {
  stage: GrnFlowStage | 'CANCELLED';
  /** Which stages are complete (for rendering ticks). */
  completed: GrnFlowStage[];
} {
  switch (status) {
    case 'DRAFT':
      return { stage: 'RECEIVED', completed: [] };
    case 'PENDING_QC':
      return { stage: 'QC', completed: ['RECEIVED'] };
    case 'QC_PASSED':
    case 'QC_PARTIAL':
    case 'QC_FAILED':
      return { stage: 'STOCK', completed: ['RECEIVED', 'QC', 'STOCK'] };
    case 'CANCELLED':
      return { stage: 'CANCELLED', completed: [] };
  }
}

/** Whether a GRN status is a finalized (QC-complete) state. */
export function isGrnFinalized(status: GoodsReceiptNoteStatus): boolean {
  return (
    status === 'QC_PASSED' ||
    status === 'QC_PARTIAL' ||
    status === 'QC_FAILED'
  );
}
