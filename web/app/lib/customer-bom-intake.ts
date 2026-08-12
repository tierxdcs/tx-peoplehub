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
