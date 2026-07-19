'use client';

import { apiFetch } from './api';

/**
 * Logistics & Dispatch client — Delivery Challans for outbound shipments.
 * Dispatching a DC generates STOCK_OUT + seeds a DRAFT invoice in Finance/AR
 * (server-side, module-to-module). Mirrors the backend entities; all Decimals
 * are serialized as strings.
 */

export type TransportMode = 'ROAD' | 'RAIL' | 'AIR' | 'SEA' | 'COURIER';

export type DeliveryChallanStatus =
  | 'DRAFT'
  | 'DISPATCHED'
  | 'IN_TRANSIT'
  | 'DELIVERED'
  | 'CANCELLED';

export const TRANSPORT_MODE_LABEL: Record<TransportMode, string> = {
  ROAD: 'Road',
  RAIL: 'Rail',
  AIR: 'Air',
  SEA: 'Sea',
  COURIER: 'Courier',
};

/** Standard document checklist for the DC (matches the reference form). */
export const DC_DOCUMENT_KEYS: { key: string; label: string }[] = [
  { key: 'deliveryChallan', label: 'Delivery Challan' },
  { key: 'commercialInvoice', label: 'Commercial Invoice' },
  { key: 'eWayBill', label: 'E-Way Bill' },
  { key: 'packingList', label: 'Packing List' },
  { key: 'coc', label: 'Certificate of Conformance' },
  { key: 'fatReport', label: 'FAT Report' },
  { key: 'qualityCertificate', label: 'Quality Certificate' },
  { key: 'ispm15Phyto', label: 'ISPM-15 / Phytosanitary' },
];

export interface DeliveryChallanLine {
  id: string;
  orderLineId: string;
  itemId: string;
  itemCode: string | null;
  description: string;
  hsnCode: string | null;
  quantity: string;
  unitOfMeasure: string;
  unitRate: string;
  lineValue: string;
  orderedQuantity: string;
  previouslyDispatched: string;
  sequence: number;
}

export interface OverDispatchWarning {
  orderLineId: string;
  description: string;
  orderedQuantity: string;
  cumulativeDispatched: string;
  message: string;
}

export interface DeliveryChallan {
  id: string;
  dcNumber: string;
  status: DeliveryChallanStatus;
  orderId: string;
  orderNumber: string | null;
  customerId: string;
  customerName: string | null;
  customerPoReference: string | null;
  dispatchDate: string;
  consigneeName: string;
  consigneeAddress: string;
  consigneeGstin: string | null;
  consigneeStateCode: string;
  transportMode: TransportMode;
  transporterName: string | null;
  vehicleOrAwbNumber: string | null;
  driverName: string | null;
  driverPhone: string | null;
  specialDeliveryInstructions: string | null;
  documentsIncluded: Record<string, boolean> | null;
  promisedDeliveryDate: string | null;
  actualDeliveryDate: string | null;
  linkedInvoiceId: string | null;
  linkedInvoiceNumber: string | null;
  linkedInvoiceStatus: string | null;
  eWayBillNumber: string | null;
  eWayBillDate: string | null;
  eWayBillValidUntil: string | null;
  podFileKey: string | null;
  podReceivedBy: string | null;
  podNotes: string | null;
  createdById: string;
  createdByName: string | null;
  lines: DeliveryChallanLine[];
  overDispatchWarnings?: OverDispatchWarning[];
  createdAt: string;
  updatedAt: string;
}

export interface DeliveryChallanLineInput {
  orderLineId: string;
  quantity: number;
  description?: string;
  sequence?: number;
}

export interface CreateDeliveryChallanInput {
  orderId: string;
  dispatchDate?: string;
  customerPoReference?: string;
  consigneeName: string;
  consigneeAddress: string;
  consigneeGstin?: string;
  consigneeStateCode: string;
  transportMode: TransportMode;
  transporterName?: string;
  vehicleOrAwbNumber?: string;
  driverName?: string;
  driverPhone?: string;
  specialDeliveryInstructions?: string;
  documentsIncluded?: Record<string, boolean>;
  promisedDeliveryDate?: string;
  lines: DeliveryChallanLineInput[];
}

export function listDeliveryChallans(
  opts: { status?: DeliveryChallanStatus; orderId?: string } = {},
) {
  const params = new URLSearchParams();
  if (opts.status) params.set('status', opts.status);
  if (opts.orderId) params.set('orderId', opts.orderId);
  const qs = params.toString();
  return apiFetch<DeliveryChallan[]>(`/logistics/delivery-challans${qs ? `?${qs}` : ''}`);
}

export function getDeliveryChallan(id: string) {
  return apiFetch<DeliveryChallan>(`/logistics/delivery-challans/${id}`);
}

export function createDeliveryChallan(input: CreateDeliveryChallanInput) {
  return apiFetch<DeliveryChallan>('/logistics/delivery-challans', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export function dispatchDeliveryChallan(id: string) {
  return apiFetch<DeliveryChallan>(`/logistics/delivery-challans/${id}/dispatch`, {
    method: 'POST',
  });
}

export function cancelDeliveryChallan(id: string) {
  return apiFetch<DeliveryChallan>(`/logistics/delivery-challans/${id}/cancel`, {
    method: 'POST',
  });
}

export function setEwayBill(
  id: string,
  input: { eWayBillNumber: string; eWayBillDate?: string; eWayBillValidUntil?: string },
) {
  return apiFetch<DeliveryChallan>(`/logistics/delivery-challans/${id}/e-way-bill`, {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export function updateDcStatus(id: string, status: 'IN_TRANSIT' | 'DELIVERED') {
  return apiFetch<DeliveryChallan>(`/logistics/delivery-challans/${id}/status`, {
    method: 'PATCH',
    body: JSON.stringify({ status }),
  });
}

export function clearFinalQc(orderId: string) {
  return apiFetch<{ orderId: string; finalQcStatus: string }>(
    `/logistics/delivery-challans/orders/${orderId}/clear-final-qc`,
    { method: 'POST' },
  );
}

export function podUploadUrl(id: string, fileName: string, contentType: string) {
  return apiFetch<{ storageKey: string; uploadUrl: string; expiresInSeconds: number }>(
    `/logistics/delivery-challans/${id}/pod/upload-url`,
    { method: 'POST', body: JSON.stringify({ fileName, contentType }) },
  );
}

export function confirmPod(
  id: string,
  input: {
    storageKey: string;
    fileName: string;
    sizeBytes: number;
    podReceivedBy?: string;
    podNotes?: string;
    actualDeliveryDate?: string;
  },
) {
  return apiFetch<DeliveryChallan>(`/logistics/delivery-challans/${id}/pod`, {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export function podDownloadUrl(id: string) {
  return apiFetch<{ url: string; expiresInSeconds: number }>(
    `/logistics/delivery-challans/${id}/pod/download-url`,
  );
}

// ── OTD ──────────────────────────────────────────────────────────────
export interface OtdReport {
  summary: {
    totalDelivered: number;
    onTime: number;
    late: number;
    onTimePercentage: number | null;
    averageDelayDays: number;
  };
  byCustomer: Array<{
    customerId: string;
    customerName: string;
    total: number;
    onTime: number;
    late: number;
    onTimePercentage: number | null;
  }>;
  dispatches: Array<{
    id: string;
    dcNumber: string;
    customerName: string;
    promisedDeliveryDate: string;
    actualDeliveryDate: string;
    delayDays: number;
    onTime: boolean;
  }>;
}

export function otdReport(opts: { from?: string; to?: string } = {}) {
  const params = new URLSearchParams();
  if (opts.from) params.set('from', opts.from);
  if (opts.to) params.set('to', opts.to);
  const qs = params.toString();
  return apiFetch<OtdReport>(`/logistics/otd${qs ? `?${qs}` : ''}`);
}
