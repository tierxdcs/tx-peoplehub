'use client';

import { apiFetch } from './api';
import type { EmailSendResult } from './invite-email';
import type {
  InspectionQuestion,
  QmsResponseType,
} from './incoming-inspection';

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
  | 'PENDING_CSCO_APPROVAL'
  | 'PENDING_COO_APPROVAL'
  | 'PENDING_CEO_APPROVAL'
  | 'APPROVED'
  | 'ISSUED'
  | 'PARTIALLY_RECEIVED'
  | 'FULLY_RECEIVED'
  | 'REJECTED'
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
  'RETURN_TO_SUPPLIER' | 'SCRAP' | 'USE_AS_IS' | 'REWORK';

export type MaterialIndentStatus =
  'OPEN' | 'PARTIALLY_ISSUED' | 'FULLY_ISSUED' | 'CANCELLED';

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
  itemId: string | null;
  itemCode: string | null;
  itemName: string;
  adHocDescription: string | null;
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

/**
 * The advance-payment leg of a PO. `status` is the underlying AP payment's own
 * status — the payment IS the request, so there is nothing that could disagree
 * with it about whether the party has been paid. Before the PO is issued no
 * request exists yet, so `status` is null and the rupee figure lives in
 * `indicativeAmount` (still moves when the lines change) rather than `amount`.
 */
export interface PurchaseOrderAdvance {
  percent: string;
  amount: string | null;
  indicativeAmount: string | null;
  paymentId: string | null;
  paymentNumber: string | null;
  status:
    | 'DRAFT'
    | 'PENDING_APPROVAL'
    | 'REJECTED'
    | 'APPROVED'
    | 'EXECUTED'
    | 'REVERSED'
    | null;
  plannedDate: string | null;
  executedDate: string | null;
  bankReference: string | null;
  rejectionComment: string | null;
}

/**
 * GST on the order: order-level rates applied once to the summed line total, the
 * same model the Sales Voucher uses on the outward side. Always present — all
 * zeroes mean the order carries no tax line, which is how every order raised
 * before GST reached the PO reads.
 *
 * `stateCode` is the SUPPLIER's registration state, because on an inward supply
 * that is what decides the split: our own state is intra-state (CGST + SGST),
 * anywhere else is inter-state (IGST).
 */
export interface PurchaseOrderGst {
  stateCode: string;
  stateName: string;
  intraState: boolean;
  igstRate: string;
  cgstRate: string;
  sgstRate: string;
  igstAmount: string;
  cgstAmount: string;
  sgstAmount: string;
  totalTax: string;
}

export interface PurchaseOrder {
  id: string;
  poNumber: string;
  status: PurchaseOrderStatus;
  supplierId: string | null;
  supplierName: string | null;
  vendorId: string | null;
  vendorName: string | null;
  adHocPartyName: string | null;
  adHocContactInfo: string | null;
  adHocPartyAddress: string | null;
  partyAddress: string | null;
  partyContactInfo: string | null;
  partyGstin: string | null;
  ceoApprovedById: string | null;
  ceoApprovedAt: string | null;
  rejectedById: string | null;
  rejectedAt: string | null;
  rejectionComment: string | null;
  orderDate: string;
  expectedDeliveryDate: string | null;
  notes: string | null;
  createdById: string;
  createdByName: string | null;
  issuedAt: string | null;
  cancelledAt: string | null;
  /** When the order PDF was last emailed to the party, and to which address. */
  lastEmailedAt: string | null;
  lastEmailedTo: string | null;
  /**
   * The address a send would default to. Null for an ad-hoc party, which has no
   * registered email — the dialog then has to ask for one.
   */
  partyEmail: string | null;
  /**
   * Sum of the line totals — the taxable value. Deliberately pre-tax: it is the
   * basis for the approval tier, the advance and AP three-way matching.
   */
  totalAmount: string;
  gst: PurchaseOrderGst;
  /** totalAmount + GST — what the party will invoice. */
  grandTotal: string;
  approvalAmount: string | null;
  /** Null when the order carries no advance commitment. */
  advance: PurchaseOrderAdvance | null;
  approvals: Array<{
    id: string;
    level: 'CSCO' | 'COO' | 'CEO';
    sequence: number;
    status: 'WAITING' | 'PENDING' | 'APPROVED' | 'REJECTED';
    decidedById: string | null;
    decidedByName: string | null;
    decidedAt: string | null;
    comment: string | null;
  }>;
  lines: PurchaseOrderLine[];
  qualificationWarning?: QualificationWarning | null;
  createdAt: string;
  updatedAt: string;
  canDelete?: boolean;
}

export interface PurchaseOrderLineInput {
  itemId?: string;
  adHocItemName?: string;
  adHocDescription?: string;
  orderedQuantity: number;
  unitPrice: number;
  unitOfMeasure?: string;
  notes?: string;
  sequence?: number;
}

export interface CreatePurchaseOrderInput {
  supplierId?: string;
  vendorId?: string;
  adHocPartyName?: string;
  adHocContactInfo?: string;
  adHocPartyAddress?: string;
  orderDate?: string;
  expectedDeliveryDate?: string;
  notes?: string;
  /**
   * Advance payable before delivery, 0.01–100 as a percentage of the pre-tax
   * line total. Registered supplier/vendor only — the server rejects it on an
   * ad-hoc PO, which has no payables account to pay from.
   */
  advancePercent?: number | null;
  /**
   * The supplier's two-digit GST state code. Omitted, the server takes it from
   * the party's GSTIN — send it only to override that (an SEZ or import supply
   * that does not follow the registration).
   */
  gstStateCode?: string;
  /**
   * Order-level GST percentages, 0–100, applied once to the summed line total.
   * Omitted rates stay zero: the server never assumes a slab, so it is this form
   * that proposes 18%.
   */
  igstRate?: number;
  cgstRate?: number;
  sgstRate?: number;
  lines: PurchaseOrderLineInput[];
}

/**
 * Edits to a DRAFT PO. Every field is optional; omitting one leaves it alone,
 * and `lines` replaces the whole set when sent.
 */
export type UpdatePurchaseOrderInput = Omit<
  Partial<CreatePurchaseOrderInput>,
  | 'supplierId'
  | 'vendorId'
  | 'adHocPartyName'
  | 'adHocContactInfo'
  | 'adHocPartyAddress'
  | 'expectedDeliveryDate'
> & {
  supplierId?: string | null;
  vendorId?: string | null;
  adHocPartyName?: string | null;
  adHocContactInfo?: string | null;
  adHocPartyAddress?: string | null;
  expectedDeliveryDate?: string | null;
};

export function listPurchaseOrders(
  opts: { status?: PurchaseOrderStatus } = {},
) {
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

/** DRAFT only — the server refuses an edit once the PO is a commitment. */
export function updatePurchaseOrder(
  id: string,
  input: UpdatePurchaseOrderInput,
) {
  return apiFetch<PurchaseOrder>(`/purchase-orders/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(input),
  });
}

export function issuePurchaseOrder(id: string) {
  return apiFetch<PurchaseOrder>(`/purchase-orders/${id}/issue`, {
    method: 'POST',
  });
}

export function submitPurchaseOrderForApproval(id: string) {
  return apiFetch<PurchaseOrder>(`/purchase-orders/${id}/submit-for-approval`, {
    method: 'POST',
  });
}

export function approvePurchaseOrder(id: string) {
  return apiFetch<PurchaseOrder>(`/purchase-orders/${id}/approve`, {
    method: 'POST',
  });
}

export function rejectPurchaseOrder(id: string, comment: string) {
  return apiFetch<PurchaseOrder>(`/purchase-orders/${id}/reject`, {
    method: 'POST',
    body: JSON.stringify({ comment }),
  });
}

export function cancelPurchaseOrder(id: string) {
  return apiFetch<PurchaseOrder>(`/purchase-orders/${id}/cancel`, {
    method: 'POST',
  });
}

export function deletePurchaseOrder(id: string) {
  return apiFetch<{ id: string; poNumber: string; deleted: true }>(
    `/purchase-orders/${id}`,
    { method: 'DELETE' },
  );
}

export function approveAdHocPurchaseOrder(id: string) {
  return apiFetch<PurchaseOrder>(`/purchase-orders/${id}/approve-ad-hoc`, {
    method: 'POST',
  });
}

export function rejectAdHocPurchaseOrder(id: string, comment: string) {
  return apiFetch<PurchaseOrder>(`/purchase-orders/${id}/reject-ad-hoc`, {
    method: 'POST',
    body: JSON.stringify({ comment }),
  });
}

/**
 * Emails an issued PO to the supplier/vendor with the order PDF attached.
 * `to` overrides the partner's registered address (and is required for an ad-hoc
 * party, which has none); `note` is added to the covering email.
 *
 * Returns the send result rather than the PO, because the two ways a send can
 * succeed without being delivered — dry-run and the recipient allowlist — have to
 * reach the user. Re-read the PO afterwards for the refreshed lastEmailedAt.
 */
export function emailPurchaseOrder(
  id: string,
  body: { to?: string; note?: string } = {},
) {
  return apiFetch<EmailSendResult>(`/purchase-orders/${id}/email`, {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

// ── Goods Receipt Notes + QC ─────────────────────────────────────────
/** One answered question of a finalized line's incoming-inspection checklist. */
export interface GrnInspectionResponse {
  questionKey: string;
  section: string;
  sequence: number;
  prompt: string;
  responseType: QmsResponseType;
  required: boolean;
  answer: string | null;
  result: 'PASS' | 'FAIL' | 'NOT_APPLICABLE' | null;
  comments: string | null;
}

/**
 * The QmsInspection recorded for a GRN line at the QC gate — the audit answer
 * to "on what basis was this accepted?". Null on lines that were finalized
 * before incoming inspection became mandatory.
 */
export interface GrnLineInspection {
  id: string;
  inspectionNumber: string;
  status:
    | 'DRAFT'
    | 'IN_PROGRESS'
    | 'PENDING_REVIEW'
    | 'PASSED'
    | 'CONDITIONAL_PASS'
    | 'FAILED'
    | 'CANCELLED';
  overallResult: 'PASS' | 'FAIL' | 'CONDITIONAL_PASS' | 'NOT_APPLICABLE' | null;
  templateCode: string | null;
  templateName: string | null;
  templateVersion: number | null;
  inspectedAt: string | null;
  remarks: string | null;
  responses: GrnInspectionResponse[];
}

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
  inspection: GrnLineInspection | null;
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

/** One answer submitted with the QC decision. The server grades it. */
export interface QcChecklistResponseInput {
  questionKey: string;
  answer?: string;
  comments?: string;
}

export interface QcInspectionLineInput {
  grnLineId: string;
  /** Approved INCOMING template this line was inspected against. Required. */
  templateId: string;
  responses: QcChecklistResponseInput[];
  acceptedQuantity: number;
  rejectedQuantity: number;
  rejectionReason?: string;
  remarks?: string;
}

/**
 * An approved incoming-inspection template, with its questions. Every GRN line
 * is inspected against one of these before its quantities can be finalized.
 */
export interface GrnInspectionTemplate {
  id: string;
  templateCode: string;
  name: string;
  version: number;
  description: string | null;
  questions: InspectionQuestion[];
}

/** Approved INCOMING templates for the QC checklist (QC inspectors only). */
export function listGrnInspectionTemplates() {
  return apiFetch<GrnInspectionTemplate[]>(
    '/goods-receipt-notes/inspection-templates',
  );
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
  return apiFetch<GoodsReceiptNote[]>(
    `/goods-receipt-notes${qs ? `?${qs}` : ''}`,
  );
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
  return apiFetch<NonConformanceReport>(
    `/non-conformance-reports/${id}/close`,
    {
      method: 'POST',
    },
  );
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
  if (opts.projectKickoffId)
    params.set('projectKickoffId', opts.projectKickoffId);
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
    status === 'QC_PASSED' || status === 'QC_PARTIAL' || status === 'QC_FAILED'
  );
}
