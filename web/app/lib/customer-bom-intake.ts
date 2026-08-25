'use client';

import { apiFetch } from './api';

export interface CustomerBomCandidate {
  id: string;
  itemCode: string;
  name: string;
  score: number;
}

export interface CustomerBomIntake {
  id: string;
  productName: string;
  rawFileName: string;
  status: string;
  product: { id: string; sku: string; name: string } | null;
  bom: { id: string; status: string; revisionNumber: number } | null;
  liveBomCostEstimate: string | null;
  suggestedUnitPrice: string | null;
  lines: Array<{
    id: string;
    description: string;
    quantity: string;
    unitOfMeasure: string;
    targetMarginPercent?: number;
    createdNewItem: boolean;
    resolvedItem: { itemCode: string; name: string };
  }>;
}

export const listCustomerBomIntakes = (opportunityId: string) =>
  apiFetch<CustomerBomIntake[]>(
    `/opportunities/${opportunityId}/customer-bom-intakes`,
  );

export const findCustomerBomMatches = (
  opportunityId: string,
  description: string,
) =>
  apiFetch<CustomerBomCandidate[]>(
    `/opportunities/${opportunityId}/customer-bom-intakes/matches`,
    { method: 'POST', body: JSON.stringify({ description }) },
  );

export const customerBomUploadUrl = (
  opportunityId: string,
  input: { fileName: string; mimeType: string; fileSize: number },
) =>
  apiFetch<{ fileKey: string; uploadUrl: string; expiresInSeconds: number }>(
    `/opportunities/${opportunityId}/customer-bom-intakes/upload-url`,
    { method: 'POST', body: JSON.stringify(input) },
  );

export const createCustomerBomIntake = (
  opportunityId: string,
  input: {
    businessUnitId: string;
    productName: string;
    unitOfMeasure: string;
    fileKey: string;
    fileName: string;
    lines: Array<{
      description: string;
      customerPartReference?: string;
      quantity: number;
      unitOfMeasure: string;
      existingItemId?: string;
      confirmCreateNew: boolean;
    }>;
  },
) =>
  apiFetch<CustomerBomIntake>(
    `/opportunities/${opportunityId}/customer-bom-intakes`,
    { method: 'POST', body: JSON.stringify(input) },
  );

// ── Open BOM Intake register / detail / revision ─────────────────────────────

export type IntakeDerivedStatus =
  | 'DRAFT'
  | 'PENDING_APPROVAL'
  | 'RFQ_FLOATED'
  | 'PRICED'
  | 'RELEASED';

export interface BomIntakeRegisterRow {
  id: string;
  productName: string;
  createdAt: string;
  derivedStatus: IntakeDerivedStatus;
  opportunity: { id: string; name: string; customer: { name: string } | null };
  businessUnit: { name: string };
  product: { sku: string; name: string } | null;
  bom: { id: string; status: string; revisionNumber: number } | null;
  createdBy: { firstName: string; lastName: string };
}

export const listBomIntakeRegister = () =>
  apiFetch<BomIntakeRegisterRow[]>('/customer-bom-intakes');

export interface BomIntakeDetail {
  id: string;
  productName: string;
  unitOfMeasure: string;
  rawFileName: string;
  createdAt: string;
  derivedStatus: IntakeDerivedStatus;
  opportunity: { id: string; name: string; customer: { name: string } | null };
  businessUnit: { name: string };
  product: { id: string; sku: string; name: string } | null;
  bom: {
    id: string;
    status: string;
    revisionNumber: number;
    lines: Array<{
      id: string;
      quantityPerUnit: string;
      unitOfMeasure: string;
      notes: string | null;
      item: { id: string; itemCode: string; name: string };
    }>;
  } | null;
  revisions: Array<{
    id: string;
    revisionNumber: number;
    status: string;
    revisionNotes: string | null;
    createdAt: string;
    createdBy: { firstName: string; lastName: string };
  }>;
  rfqs: Array<{
    id: string;
    rfqNumber: string;
    title: string;
    status: string;
    createdAt: string;
    createdBy: { firstName: string; lastName: string };
  }>;
  liveBomCostEstimate: string | null;
  suggestedUnitPrice: string | null;
  createdBy: { firstName: string; lastName: string };
}

export const getBomIntake = (id: string) =>
  apiFetch<BomIntakeDetail>(`/customer-bom-intakes/${id}`);

export const reviseBomIntake = (
  id: string,
  input: {
    revisionNotes: string;
    lines: Array<{
      description: string;
      customerPartReference?: string;
      quantity: number;
      unitOfMeasure: string;
      existingItemId?: string;
      confirmCreateNew: boolean;
    }>;
  },
) =>
  apiFetch<BomIntakeDetail>(`/customer-bom-intakes/${id}/revise`, {
    method: 'POST',
    body: JSON.stringify(input),
  });

export const INTAKE_STATUS_LABEL: Record<IntakeDerivedStatus, string> = {
  DRAFT: 'Draft',
  PENDING_APPROVAL: 'Pending R&D approval',
  RFQ_FLOATED: 'RFQ Floated',
  PRICED: 'Priced',
  RELEASED: 'Released',
};

/** Signal ToneChip tone per derived status. */
export const INTAKE_STATUS_TONE: Record<
  IntakeDerivedStatus,
  'neutral' | 'info' | 'success' | 'warning' | 'danger'
> = {
  DRAFT: 'neutral',
  PENDING_APPROVAL: 'warning',
  RFQ_FLOATED: 'info',
  PRICED: 'success',
  RELEASED: 'success',
};
