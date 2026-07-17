'use client';

import { apiFetch } from './api';

/** Inventory + stock-availability + reservations client (§6–9). */

export type StockBucket = 'ON_HAND' | 'BLOCKED';

export interface StoreLocation {
  id: string;
  code: string;
  name: string;
  isActive: boolean;
}

export interface StockBalance {
  id: string;
  itemId: string;
  itemCode: string;
  itemName: string;
  baseUnitOfMeasure: string;
  storeLocationId: string;
  storeLocationName: string;
  onHandQuantity: string;
  reservedQuantity: string;
  blockedQuantity: string;
  availableQuantity: string;
  expectedReceiptQuantity: string | null;
  expectedReceiptDate: string | null;
  updatedAt: string;
}

export interface StockAdjustment {
  id: string;
  itemId: string;
  storeLocationId: string;
  bucket: StockBucket;
  quantityChange: string;
  reason: string;
  actorId: string | null;
  actorName: string | null;
  createdAt: string;
}

export interface StockAdjustmentInput {
  itemId: string;
  storeLocationId: string;
  bucket?: StockBucket;
  quantityChange: number;
  reason: string;
  expectedReceiptQuantity?: number;
  expectedReceiptDate?: string;
}

export type AvailabilityStatus =
  | 'AVAILABLE'
  | 'EXPECTED_BEFORE_REQUIRED_DATE'
  | 'SHORTAGE'
  | 'UNKNOWN';

export interface StockAvailabilityRow {
  itemId: string | null;
  itemCode: string;
  itemName: string;
  unitOfMeasure: string;
  bomRevisionSources: string[];
  orderedProductQuantity: string;
  baseRequirement: string;
  wastagePercent: string;
  wastageQuantity: string;
  grossRequirement: string;
  onHandQuantity: string;
  reservedQuantity: string;
  blockedQuantity: string;
  availableQuantity: string;
  reservedForThisKickoff: string;
  expectedReceiptQuantity: string | null;
  expectedReceiptDate: string | null;
  shortageQuantity: string;
  surplusQuantity: string;
  reservedRequiredQuantity: string;
  unreservedRequiredQuantity: string;
  availabilityStatus: AvailabilityStatus;
}

export interface BomSelection {
  orderLineItemId: string;
  productId: string;
  productName: string;
  productSku: string;
  orderedQuantity: string;
  bomId: string;
  bomRevisionNumber: number;
}

export interface StockAvailabilityReport {
  kickoffId: string;
  generatedAt: string;
  quantityPrecision: number;
  bomSelections: BomSelection[];
  rows: StockAvailabilityRow[];
  summary: {
    available: number;
    expected: number;
    shortage: number;
    unknown: number;
    totalItems: number;
  };
}

export interface Reservation {
  id: string;
  kickoffId: string;
  itemId: string;
  itemCode: string;
  itemName: string;
  storeLocationId: string;
  storeLocationName: string;
  quantity: string;
  isActive: boolean;
  createdById: string;
  createdAt: string;
  cancelledAt: string | null;
}

export interface CreateReservationInput {
  itemId: string;
  storeLocationId: string;
  quantity: number;
  allowOverride?: boolean;
}

export const AVAILABILITY_LABEL: Record<AvailabilityStatus, string> = {
  AVAILABLE: 'Available',
  EXPECTED_BEFORE_REQUIRED_DATE: 'Expected in time',
  SHORTAGE: 'Shortage',
  UNKNOWN: 'Unknown',
};

// ── Inventory ────────────────────────────────────────────────────────
export function listStores() {
  return apiFetch<StoreLocation[]>('/inventory/stores');
}

export function listInventory(opts: { search?: string; storeLocationId?: string } = {}) {
  const qs = new URLSearchParams();
  if (opts.search) qs.set('search', opts.search);
  if (opts.storeLocationId) qs.set('storeLocationId', opts.storeLocationId);
  const q = qs.toString();
  return apiFetch<StockBalance[]>(`/inventory${q ? `?${q}` : ''}`);
}

export function itemBalances(itemId: string) {
  return apiFetch<StockBalance[]>(`/inventory/items/${itemId}`);
}

export function itemAdjustmentHistory(itemId: string) {
  return apiFetch<StockAdjustment[]>(`/inventory/items/${itemId}/adjustments`);
}

export function adjustStock(input: StockAdjustmentInput) {
  return apiFetch<StockBalance>('/inventory/adjustments', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

// ── Kickoff stock-availability + reservations ────────────────────────
export function generateStockReport(kickoffId: string) {
  return apiFetch<StockAvailabilityReport>(
    `/project-kickoffs/${kickoffId}/stock-availability/generate`,
    { method: 'POST' },
  );
}

export function getStockReport(kickoffId: string) {
  return apiFetch<StockAvailabilityReport | null>(
    `/project-kickoffs/${kickoffId}/stock-availability`,
  );
}

export function listReservations(kickoffId: string) {
  return apiFetch<Reservation[]>(`/project-kickoffs/${kickoffId}/reservations`);
}

export function createReservation(kickoffId: string, input: CreateReservationInput) {
  return apiFetch<Reservation>(`/project-kickoffs/${kickoffId}/reservations`, {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export function cancelReservation(kickoffId: string, reservationId: string) {
  return apiFetch<void>(
    `/project-kickoffs/${kickoffId}/reservations/${reservationId}`,
    { method: 'DELETE' },
  );
}
