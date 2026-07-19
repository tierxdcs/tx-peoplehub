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

export type ItemType =
  | 'RAW_MATERIAL'
  | 'COMPONENT'
  | 'SUBASSEMBLY'
  | 'FINISHED_GOOD'
  | 'CONSUMABLE';

export interface Bom {
  id: string;
  /** The Item Master item this BOM is FOR (keyed on Item, not Product). */
  itemId: string;
  itemCode: string | null;
  itemName: string | null;
  itemType: ItemType | null;
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
  itemId: string;
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

export function listBoms(opts: { itemId?: string; status?: BomStatus } = {}) {
  const qs = new URLSearchParams();
  if (opts.itemId) qs.set('itemId', opts.itemId);
  if (opts.status) qs.set('status', opts.status);
  const q = qs.toString();
  return apiFetch<Bom[]>(`/boms${q ? `?${q}` : ''}`);
}

export function listBomsForItem(itemId: string) {
  return apiFetch<Bom[]>(`/items/${itemId}/boms`);
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

// ── Item ↔ Supplier links (release hard-gate) ─────────────────────────
export interface ItemSupplierLink {
  id: string;
  itemId: string;
  supplierId: string;
  supplierName: string;
  supplierStatus: string;
  isQualified: boolean;
  supplierPartNumber: string | null;
  createdById: string;
  createdAt: string;
}

export function listItemSuppliers(itemId: string) {
  return apiFetch<ItemSupplierLink[]>(`/items/${itemId}/suppliers`);
}

export function linkItemSupplier(
  itemId: string,
  input: { supplierId: string; supplierPartNumber?: string },
) {
  return apiFetch<ItemSupplierLink>(`/items/${itemId}/suppliers`, {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export function unlinkItemSupplier(itemId: string, linkId: string) {
  return apiFetch<void>(`/items/${itemId}/suppliers/${linkId}`, {
    method: 'DELETE',
  });
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
