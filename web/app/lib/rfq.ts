'use client';

import { apiFetch } from './api';

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
  sequence: number;
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
}

export interface Rfq {
  id: string;
  rfqNumber: string;
  title: string;
  description: string | null;
  status: RfqStatus;
  projectKickoffId: string | null;
  projectName: string | null;
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
  lines: RfqLine[];
  invitees: RfqInvitee[];
  quotesVisible: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface RfqLineInput {
  itemId: string;
  quantity: number;
  unitOfMeasure?: string;
  specificationNotes?: string;
  sequence?: number;
}

export interface CreateRfqInput {
  title: string;
  description?: string;
  projectKickoffId?: string;
  submissionDeadline: string;
  requiredByDate?: string;
  deliveryLocation?: string;
  paymentTermsRequested?: string;
  lines: RfqLineInput[];
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
  quotedLeadTimeDays: number | null;
  paymentTermsOffered: string | null;
  validityDays: number | null;
  attachmentFileKeys: string[];
  weightedScore: string | null;
  lines: ComparisonQuoteLine[];
}
export interface RfqComparison {
  rfqId: string;
  rfqNumber: string;
  status: string;
  weights: { price: number; leadTime: number; qualification: number };
  lines: { rfqLineId: string; itemCode: string | null; itemName: string | null; quantity: string; unitOfMeasure: string }[];
  columns: ComparisonColumn[];
}

// ── SCM-facing API ───────────────────────────────────────────────────────
export function listRfqs(opts: { status?: RfqStatus } = {}) {
  const qs = opts.status ? `?status=${opts.status}` : '';
  return apiFetch<Rfq[]>(`/rfqs${qs}`);
}
export function getRfq(id: string) {
  return apiFetch<Rfq>(`/rfqs/${id}`);
}
export function createRfq(input: CreateRfqInput) {
  return apiFetch<Rfq>('/rfqs', { method: 'POST', body: JSON.stringify(input) });
}
export function updateRfq(id: string, input: Partial<CreateRfqInput>) {
  return apiFetch<Rfq>(`/rfqs/${id}`, { method: 'PATCH', body: JSON.stringify(input) });
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
  return apiFetch<Rfq>(`/rfqs/${id}/invitees/${inviteeId}`, { method: 'DELETE' });
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
  if (weights?.leadTime != null) params.set('leadTime', String(weights.leadTime));
  if (weights?.qualification != null) params.set('qualification', String(weights.qualification));
  const qs = params.toString();
  return apiFetch<RfqComparison>(`/rfqs/${id}/comparison${qs ? `?${qs}` : ''}`);
}
export function awardRfq(id: string, inviteeId: string, justification?: string) {
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
  rfq: {
    rfqNumber: string;
    title: string;
    description: string | null;
    submissionDeadline: string;
    requiredByDate: string | null;
    deliveryLocation: string | null;
    paymentTermsRequested: string | null;
    status: RfqStatus;
    lines: { id: string; itemCode: string | null; itemName: string | null; quantity: string; unitOfMeasure: string; specificationNotes: string | null }[];
  };
  quote: {
    quotedLeadTimeDays: number | null;
    paymentTermsOffered: string | null;
    validityDays: number | null;
    notes: string | null;
    attachmentFileKeys: string[];
    totalQuotedValue: string;
    lines: { rfqLineId: string; unitPrice: string; lineTotal: string; deliveryLeadTimeDays: number | null; remarks: string | null }[];
  } | null;
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
): Promise<{ ok: true; data: T } | { ok: false; status: number; message: string }> {
  const res = await fetch(`${API_URL}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json.success === false) {
    return { ok: false, status: res.status, message: json.message ?? 'Request failed' };
  }
  return { ok: true, data: json.data as T };
}

export const publicResolveRfq = (token: string, password?: string) =>
  publicPost<PublicRfqView>(`/public/rfq-quote/${token}/resolve`, { password });
export const publicSaveRfqQuote = (
  token: string,
  body: { password?: string; quotedLeadTimeDays?: number; paymentTermsOffered?: string; validityDays?: number; notes?: string; lines?: PublicQuoteLineInput[] },
) => publicPost<PublicRfqView>(`/public/rfq-quote/${token}/save`, body);
export const publicSubmitRfqQuote = (
  token: string,
  body: { password?: string; quotedLeadTimeDays?: number; paymentTermsOffered?: string; validityDays?: number; notes?: string; lines: PublicQuoteLineInput[] },
) => publicPost<PublicRfqView>(`/public/rfq-quote/${token}/submit`, body);
export const publicDeclineRfq = (token: string, body: { password?: string; declineReason?: string }) =>
  publicPost<PublicRfqView>(`/public/rfq-quote/${token}/decline`, body);
export const publicRfqAttachmentUploadUrl = (
  token: string,
  body: { password?: string; name: string; mimeType: string; sizeBytes: number },
) => publicPost<{ storageKey: string; uploadUrl: string; expiresInSeconds: number }>(`/public/rfq-quote/${token}/attachment-upload-url`, body);
export const publicRfqAttachmentConfirm = (
  token: string,
  body: { password?: string; storageKey: string; name: string },
) => publicPost<PublicRfqView>(`/public/rfq-quote/${token}/attachment-confirm`, body);
