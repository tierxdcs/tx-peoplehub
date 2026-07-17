'use client';

import { apiFetch } from './api';

/** BOM client (§3–4). Author = R&D vertical; approve/reject = R&D Head (backend-enforced). */

export type BomStatus =
  | 'DRAFT'
  | 'PENDING_APPROVAL'
  | 'REJECTED'
  | 'RELEASED'
  | 'OBSOLETE';

export type BomLineSource = 'MAKE' | 'BUY';

export interface BomLine {
  id: string;
  itemId: string;
  itemCode: string;
  itemName: string;
  quantityPerUnit: string;
  unitOfMeasure: string;
  wastagePercent: string;
  makeBuy: BomLineSource;
  notes: string | null;
  drawingSpecReference: string | null;
  sequence: number;
}

export interface BomEvent {
  id: string;
  type: string;
  actorId: string | null;
  actorName: string | null;
  comment: string | null;
  createdAt: string;
}

export interface Bom {
  id: string;
  productId: string;
  productName: string | null;
  productSku: string | null;
  revisionNumber: number;
  status: BomStatus;
  effectiveDate: string | null;
  revisionNotes: string | null;
  createdById: string;
  createdByName: string | null;
  submittedById: string | null;
  submittedAt: string | null;
  approvedById: string | null;
  approvedByName: string | null;
  approvedAt: string | null;
  rejectedById: string | null;
  rejectedAt: string | null;
  rejectionComment: string | null;
  approverSignatureTextSnapshot: string | null;
  approverSignatureFontSnapshot: string | null;
  lines: BomLine[];
  events?: BomEvent[];
  createdAt: string;
  updatedAt: string;
}

export interface BomLineInput {
  itemId: string;
  quantityPerUnit: number;
  unitOfMeasure: string;
  wastagePercent?: number;
  makeBuy?: BomLineSource;
  notes?: string;
  drawingSpecReference?: string;
  sequence?: number;
}

export interface CreateBomInput {
  productId: string;
  effectiveDate?: string;
  revisionNotes?: string;
  lines: BomLineInput[];
}

export interface UpdateBomInput {
  effectiveDate?: string;
  revisionNotes?: string;
  lines?: BomLineInput[];
}

export const BOM_STATUS_LABEL: Record<BomStatus, string> = {
  DRAFT: 'Draft',
  PENDING_APPROVAL: 'Pending Approval',
  REJECTED: 'Rejected',
  RELEASED: 'Released',
  OBSOLETE: 'Obsolete',
};

export function listBoms(opts: { productId?: string; status?: BomStatus } = {}) {
  const qs = new URLSearchParams();
  if (opts.productId) qs.set('productId', opts.productId);
  if (opts.status) qs.set('status', opts.status);
  const q = qs.toString();
  return apiFetch<Bom[]>(`/boms${q ? `?${q}` : ''}`);
}

export function listBomsForProduct(productId: string) {
  return apiFetch<Bom[]>(`/products/${productId}/boms`);
}

export function pendingApprovalBoms() {
  return apiFetch<Bom[]>('/boms/pending-approval');
}

export function getBom(id: string) {
  return apiFetch<Bom>(`/boms/${id}`);
}

export function createBom(input: CreateBomInput) {
  return apiFetch<Bom>('/boms', { method: 'POST', body: JSON.stringify(input) });
}

export function updateBom(id: string, input: UpdateBomInput) {
  return apiFetch<Bom>(`/boms/${id}`, { method: 'PATCH', body: JSON.stringify(input) });
}

export function submitBom(id: string) {
  return apiFetch<Bom>(`/boms/${id}/submit`, { method: 'POST' });
}

export function approveBom(id: string) {
  return apiFetch<Bom>(`/boms/${id}/approve`, { method: 'POST' });
}

export function rejectBom(id: string, comment: string) {
  return apiFetch<Bom>(`/boms/${id}/reject`, {
    method: 'POST',
    body: JSON.stringify({ comment }),
  });
}

export function newBomRevision(id: string) {
  return apiFetch<Bom>(`/boms/${id}/new-revision`, { method: 'POST' });
}
