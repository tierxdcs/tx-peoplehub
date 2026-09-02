'use client';

import { apiFetch } from './api';
import type { RfqInviteeEmailSummary } from './rfq-invite-email';

/**
 * RFQ Builder (SCM) client. Sealed-bid: the detail/list endpoints carry no quote
 * figures; quote values live in the comparison endpoint which the server guards
 * until the RFQ is closed.
 */

export type RfqStatus = 'DRAFT' | 'ISSUED' | 'CLOSED' | 'AWARDED' | 'CANCELLED';
export type RfqQuoteStatus = 'INVITED' | 'VIEWED' | 'SUBMITTED' | 'DECLINED';

export interface RfqLine {
  id: string;
  itemId: string;
  itemCode: string | null;
  itemName: string | null;
  quantity: string;
  unitOfMeasure: string;
  specificationNotes: string | null;
  targetPrice: string | null;
  sequence: number;
}

export interface RfqTechnicalAttachment {
  id: string;
  rfqLineId: string | null;
  fileName: string;
  fileSize: number;
  mimeType: string;
  uploadedByName: string;
  uploadedAt: string;
}

export interface RfqTechnicalView {
  maxDrawingFileSizeBytes: number;
  attachments: RfqTechnicalAttachment[];
  lineBoms: Array<{
    rfqLineId: string;
    revisionNumber: number | null;
    components: Array<{
      itemId: string;
      itemCode: string | null;
      itemName: string | null;
      quantity: string;
      unitOfMeasure: string;
      specification: string | null;
      sourceTrail: string[];
    }>;
  }>;
}

export interface RfqInvitee {
  id: string;
  supplierId: string | null;
  vendorId: string | null;
  partnerType: 'SUPPLIER' | 'VENDOR';
  partnerName: string | null;
  qualificationStatusSnapshot: string;
  quoteStatus: RfqQuoteStatus;
  submittedAt: string | null;
  declineReason: string | null;
  revokedAt: string | null;
  inviteToken: string | null;
  // Negotiated quote revisions — scoped to this invitee's own link.
  latestRevisionNumber: number | null;
  submittedRevisionCount: number;
  revisionRequestedAt: string | null;
  revisionDeadline: string | null;
  revisionNote: string | null;
  revisionRequestedByName: string | null;
  /** True while a requested revision is still outstanding (link reopened). */
  revisionPending: boolean;
}

export interface Rfq {
  id: string;
  rfqNumber: string;
  title: string;
  description: string | null;
  status: RfqStatus;
  projectKickoffId: string | null;
  projectName: string | null;
  orderId: string | null;
  orderNumber: string | null;
  orderStatus: string | null;
  orderTotal: string | null;
  customerName: string | null;
  orderLines: RfqOrderLine[];
  submissionDeadline: string;
  requiredByDate: string | null;
  deliveryLocation: string | null;
  paymentTermsRequested: string | null;
  awardedInviteeId: string | null;
  awardDecisionByName: string | null;
  awardDecisionAt: string | null;
  awardJustification: string | null;
  createdById: string;
  createdByName: string | null;
  // Project Manager approval gate (before invitee links are generated).
  pmApproved: boolean;
  pmApprovedByName: string | null;
  pmApprovedAt: string | null;
  pmRejectionComment: string | null;
  pmApproverName: string | null;
  canApprove: boolean;
  lines: RfqLine[];
  invitees: RfqInvitee[];
  quotesVisible: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface RfqOrderLine {
  orderLineId: string;
  productSku: string;
  productName: string;
  quantity: string;
  unitOfMeasure: string;
  unitPrice: string;
  lineTotal: string;
}

export interface RfqProjectOption {
  projectKickoffId: string;
  projectName: string;
  kickoffStatus: string;
  orderId: string;
  orderNumber: string;
  orderStatus: string;
  orderTotal: string;
  customerName: string;
  lines: RfqOrderLine[];
}

export interface RfqSourcingLine {
  itemId: string;
  itemCode: string;
  itemName: string;
  requiredQuantity: string;
  unitOfMeasure: string;
}

export interface RfqProductBomOption {
  productId: string;
  sku: string;
  productName: string;
  itemId: string | null;
  itemCode: string | null;
  itemName: string | null;
  itemType: import('./scm-item-master').ItemType;
  unitOfMeasure: string;
  hasReleasedBom: boolean;
}

export interface RfqProductBomExplosion {
  product: {
    id: string;
    sku: string;
    name: string;
    item: null | {
      id: string;
      itemCode: string;
      name: string;
      baseUnitOfMeasure: string;
    };
  };
  quantity: string;
  isCostComplete: boolean;
  lines: Array<
    RfqSourcingLine & {
      itemType: import('./scm-item-master').ItemType;
      unitCost: string | null;
      costSource: string | null;
      extendedCost: string | null;
    }
  >;
}

export interface RfqLineInput {
  itemId: string;
  quantity: number;
  unitOfMeasure?: string;
  specificationNotes?: string;
  targetPrice?: number;
  sequence?: number;
}

export interface CreateRfqInput {
  title: string;
  description?: string;
  projectKickoffId?: string;
  customerBomIntakeId?: string;
  submissionDeadline: string;
  requiredByDate?: string;
  deliveryLocation?: string;
  paymentTermsRequested?: string;
  lines: RfqLineInput[];
  /** OrderLineItem ids to exclude from the linked order's context. Omit = all. */
  excludedOrderLineIds?: string[];
}

export interface RfqQuoteStageOption {
  id: string;
  productName: string;
  opportunity: { id: string; name: string };
  businessUnit: { name: string };
  bom: { revisionNumber: number; status: string } | null;
  attachments: Array<{ id: string; fileName: string }>;
}

// ── Comparison ─────────────────────────────────────────────────────────
export interface ComparisonQuoteLine {
  rfqLineId: string;
  unitPrice: string | null;
  lineTotal: string | null;
  isLowestUnitPrice: boolean;
}
export interface ComparisonColumn {
  inviteeId: string;
  partnerType: 'SUPPLIER' | 'VENDOR';
  partnerName: string | null;
  qualificationStatusSnapshot: string;
  quoteStatus: RfqQuoteStatus;
  nonResponder: boolean;
  declineReason: string | null;
  totalQuotedValue: string | null;
  varianceVsLowest: string | null;
  variancePctVsLowest: string | null;
  isLowestTotal: boolean;
  /**
   * What the comparison scores on: the quote's summary lead time, or the slowest
   * of its per-line delivery lead times when the summary field was left blank.
   */
  quotedLeadTimeDays: number | null;
  /** True when the figure above came from the lines rather than the summary. */
  leadTimeFromLines: boolean;
  paymentTermsOffered: string | null;
  validityDays: number | null;
  attachmentFileKeys: string[];
  weightedScore: string | null;
  /** The revision every figure in this column comes from. Null = non-responder. */
  revisionNumber: number | null;
  /** Every submitted revision, newest first — the negotiation trail. */
  revisions: ComparisonRevision[];
  lines: ComparisonQuoteLine[];
}
export interface ComparisonRevision {
  revisionNumber: number;
  submittedAt: string | null;
  totalQuotedValue: string;
  quotedLeadTimeDays: number | null;
}
export interface RfqComparison {
  rfqId: string;
  rfqNumber: string;
  status: string;
  weights: { price: number; leadTime: number; qualification: number };
  lines: {
    rfqLineId: string;
    itemCode: string | null;
    itemName: string | null;
    quantity: string;
    unitOfMeasure: string;
  }[];
  columns: ComparisonColumn[];
}

// ── SCM-facing API ───────────────────────────────────────────────────────
export function listRfqs(opts: { status?: RfqStatus } = {}) {
  const qs = opts.status ? `?status=${opts.status}` : '';
  return apiFetch<Rfq[]>(`/rfqs${qs}`);
}
export function listRfqProjectOptions() {
  return apiFetch<RfqProjectOption[]>('/rfqs/project-options');
}
export function listRfqQuoteStageOptions() {
  return apiFetch<RfqQuoteStageOption[]>('/rfqs/quote-stage-options');
}
export function listRfqProductBomOptions() {
  return apiFetch<RfqProductBomOption[]>('/rfqs/product-bom-options');
}
export function getRfqProductBomExplosion(productId: string, quantity = 1) {
  return apiFetch<RfqProductBomExplosion>(
    `/rfqs/product-bom-options/${productId}/explosion?quantity=${encodeURIComponent(String(quantity))}`,
  );
}
export function getRfqQuoteStageSourcingLines(intakeId: string) {
  return apiFetch<RfqSourcingLine[]>(
    `/rfqs/quote-stage-options/${intakeId}/sourcing-lines`,
  );
}
export function getRfqQuoteStageAttachment(intakeId: string, attachmentId: string) {
  return apiFetch<{ url: string; fileName: string; expiresInSeconds: number }>(
    `/rfqs/quote-stage-options/${intakeId}/attachments/${attachmentId}`,
  );
}
export function getRfqSourcingLines(
  projectKickoffId: string,
  excludedOrderLineIds: string[] = [],
) {
  const query = excludedOrderLineIds.length
    ? `?excludedOrderLineIds=${encodeURIComponent(excludedOrderLineIds.join(','))}`
    : '';
  return apiFetch<RfqSourcingLine[]>(
    `/rfqs/project-options/${projectKickoffId}/sourcing-lines${query}`,
  );
}
export function getRfq(id: string) {
  return apiFetch<Rfq>(`/rfqs/${id}`);
}
export function getRfqTechnicalDocuments(id: string) {
  return apiFetch<RfqTechnicalView>(`/rfqs/${id}/technical-documents`);
}
export function rfqTechnicalUploadUrl(
  id: string,
  input: {
    fileName: string;
    mimeType: string;
    fileSize: number;
    rfqLineId?: string;
  },
) {
  return apiFetch<{
    fileKey: string;
    uploadUrl: string;
    expiresInSeconds: number;
  }>(`/rfqs/${id}/technical-attachments/upload-url`, {
    method: 'POST',
    body: JSON.stringify(input),
  });
}
export function confirmRfqTechnicalUpload(
  id: string,
  input: { fileKey: string; fileName: string; rfqLineId?: string },
) {
  return apiFetch(`/rfqs/${id}/technical-attachments/confirm`, {
    method: 'POST',
    body: JSON.stringify(input),
  });
}
export function downloadRfqTechnicalAttachment(
  id: string,
  attachmentId: string,
) {
  return apiFetch<{ url: string; expiresInSeconds: number; fileName: string }>(
    `/rfqs/${id}/technical-attachments/${attachmentId}/download`,
    { method: 'POST' },
  );
}
export function deleteRfqTechnicalAttachment(id: string, attachmentId: string) {
  return apiFetch<void>(`/rfqs/${id}/technical-attachments/${attachmentId}`, {
    method: 'DELETE',
  });
}
export function createRfq(input: CreateRfqInput) {
  return apiFetch<Rfq>('/rfqs', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}
export function updateRfq(id: string, input: Partial<CreateRfqInput>) {
  return apiFetch<Rfq>(`/rfqs/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(input),
  });
}
/**
 * Delete a DRAFT RFQ outright (lines, invitees and technical drawings go with
 * it). Only DRAFT is deletable — from ISSUED on, use cancelRfq.
 */
export function deleteRfq(id: string) {
  return apiFetch<void>(`/rfqs/${id}`, { method: 'DELETE' });
}
export function addInvitee(
  id: string,
  input: { supplierId?: string; vendorId?: string; password?: string },
) {
  return apiFetch<{ rfq: Rfq; qualificationWarning: string | null }>(
    `/rfqs/${id}/invitees`,
    { method: 'POST', body: JSON.stringify(input) },
  );
}
export function removeInvitee(id: string, inviteeId: string) {
  return apiFetch<Rfq>(`/rfqs/${id}/invitees/${inviteeId}`, {
    method: 'DELETE',
  });
}
/**
 * Email the public quote link to invitees. Omit `inviteeIds` to mail everyone on
 * the RFQ; naming ids narrows it and also mails partners who already submitted
 * or declined (a blanket send skips those as a courtesy). Sends the token each
 * invitee already has, so a re-send never invalidates a live link.
 */
export function emailInvitees(
  id: string,
  input: { inviteeIds?: string[]; note?: string } = {},
) {
  return apiFetch<RfqInviteeEmailSummary>(`/rfqs/${id}/invitees/email`, {
    method: 'POST',
    body: JSON.stringify(input),
  });
}
/**
 * Reopen ONE invitee's link on a CLOSED RFQ so they can send a negotiated
 * revised quote (Revision 2+). Never reopens the RFQ or any other invitee, and
 * needs no fresh PM approval — it is an SCM operational action.
 */
export function requestQuoteRevision(
  id: string,
  inviteeId: string,
  input: { revisionDeadline: string; note?: string; password?: string },
) {
  return apiFetch<Rfq>(`/rfqs/${id}/invitees/${inviteeId}/request-revision`, {
    method: 'POST',
    body: JSON.stringify(input),
  });
}
export function approveRfq(id: string) {
  return apiFetch<Rfq>(`/rfqs/${id}/approve`, { method: 'POST' });
}
export function rejectRfq(id: string, comment: string) {
  return apiFetch<Rfq>(`/rfqs/${id}/reject`, {
    method: 'POST',
    body: JSON.stringify({ comment }),
  });
}
export function issueRfq(id: string) {
  return apiFetch<Rfq>(`/rfqs/${id}/issue`, { method: 'POST' });
}
export function closeRfq(id: string) {
  return apiFetch<Rfq>(`/rfqs/${id}/close`, { method: 'POST' });
}
export function cancelRfq(id: string) {
  return apiFetch<Rfq>(`/rfqs/${id}/cancel`, { method: 'POST' });
}
export function rfqComparison(
  id: string,
  weights?: { price?: number; leadTime?: number; qualification?: number },
) {
  const params = new URLSearchParams();
  if (weights?.price != null) params.set('price', String(weights.price));
  if (weights?.leadTime != null)
    params.set('leadTime', String(weights.leadTime));
  if (weights?.qualification != null)
    params.set('qualification', String(weights.qualification));
  const qs = params.toString();
  return apiFetch<RfqComparison>(`/rfqs/${id}/comparison${qs ? `?${qs}` : ''}`);
}
export function awardRfq(
  id: string,
  inviteeId: string,
  justification?: string,
) {
  return apiFetch<{ rfq: Rfq; purchaseOrderId: string }>(`/rfqs/${id}/award`, {
    method: 'POST',
    body: JSON.stringify({ inviteeId, justification }),
  });
}
export function createRfqFromKickoff(kickoffId: string) {
  return apiFetch<Rfq>(`/rfqs/from-kickoff/${kickoffId}`, { method: 'POST' });
}

// ── Public (unauthenticated) quote submission ────────────────────────────
const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3000';

export interface PublicRfqView {
  inviteeId: string;
  partnerName: string | null;
  quoteStatus: RfqQuoteStatus;
  declineReason: string | null;
  /**
   * This invitee's negotiated-revision state. While `open` is true the form is
   * editable and submittable even though the RFQ has closed and the previous
   * offer is locked; `revisionNumber` is the revision about to be submitted.
   */
  revision: {
    open: boolean;
    revisionNumber: number;
    requestedAt: string | null;
    deadline: string | null;
    note: string | null;
  };
  rfq: {
    rfqNumber: string;
    title: string;
    description: string | null;
    submissionDeadline: string;
    requiredByDate: string | null;
    deliveryLocation: string | null;
    paymentTermsRequested: string | null;
    status: RfqStatus;
    lines: {
      id: string;
      itemCode: string | null;
      itemName: string | null;
      quantity: string;
      unitOfMeasure: string;
      specificationNotes: string | null;
      targetPrice: string | null;
    }[];
  };
  quote: {
    quotedLeadTimeDays: number | null;
    paymentTermsOffered: string | null;
    validityDays: number | null;
    notes: string | null;
    attachmentFileKeys: string[];
    totalQuotedValue: string;
    lines: {
      rfqLineId: string;
      unitPrice: string;
      lineTotal: string;
      deliveryLeadTimeDays: number | null;
      remarks: string | null;
    }[];
  } | null;
  technical: RfqTechnicalView;
}

export interface PublicQuoteLineInput {
  rfqLineId: string;
  unitPrice: number;
  deliveryLeadTimeDays?: number;
  remarks?: string;
}

/** Bare fetch (no auth token) for the public token endpoints. Returns a
 *  discriminated result so the page can render clean error states. */
async function publicPost<T>(
  path: string,
  body: unknown,
): Promise<
  { ok: true; data: T } | { ok: false; status: number; message: string }
> {
  const res = await fetch(`${API_URL}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json.success === false) {
    return {
      ok: false,
      status: res.status,
      message: json.message ?? 'Request failed',
    };
  }
  return { ok: true, data: json.data as T };
}

export const publicResolveRfq = (token: string, password?: string) =>
  publicPost<PublicRfqView>(`/public/rfq-quote/${token}/resolve`, { password });
export const publicSaveRfqQuote = (
  token: string,
  body: {
    password?: string;
    quotedLeadTimeDays?: number;
    paymentTermsOffered?: string;
    validityDays?: number;
    notes?: string;
    lines?: PublicQuoteLineInput[];
  },
) => publicPost<PublicRfqView>(`/public/rfq-quote/${token}/save`, body);
export const publicSubmitRfqQuote = (
  token: string,
  body: {
    password?: string;
    quotedLeadTimeDays?: number;
    paymentTermsOffered?: string;
    validityDays?: number;
    notes?: string;
    lines: PublicQuoteLineInput[];
  },
) => publicPost<PublicRfqView>(`/public/rfq-quote/${token}/submit`, body);
export const publicDeclineRfq = (
  token: string,
  body: { password?: string; declineReason?: string },
) => publicPost<PublicRfqView>(`/public/rfq-quote/${token}/decline`, body);
export const publicRfqAttachmentUploadUrl = (
  token: string,
  body: {
    password?: string;
    name: string;
    mimeType: string;
    sizeBytes: number;
  },
) =>
  publicPost<{
    storageKey: string;
    uploadUrl: string;
    expiresInSeconds: number;
  }>(`/public/rfq-quote/${token}/attachment-upload-url`, body);
export const publicRfqAttachmentConfirm = (
  token: string,
  body: { password?: string; storageKey: string; name: string },
) =>
  publicPost<PublicRfqView>(
    `/public/rfq-quote/${token}/attachment-confirm`,
    body,
  );
export const publicRfqTechnicalDownload = (
  token: string,
  body: { password?: string; attachmentId: string },
) =>
  publicPost<{ url: string; expiresInSeconds: number; fileName: string }>(
    `/public/rfq-quote/${token}/technical-attachment-download`,
    body,
  );
