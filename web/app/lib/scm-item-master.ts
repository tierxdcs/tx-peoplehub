'use client';

import { apiFetch } from './api';

/** Item Master client (§2). Read broad; create/update = R&D Head (backend-enforced). */

export type ItemType =
  | 'RAW_MATERIAL'
  | 'COMPONENT'
  | 'SUBASSEMBLY'
  | 'FINISHED_GOOD'
  | 'CONSUMABLE';

export const ITEM_TYPE_LABEL: Record<ItemType, string> = {
  RAW_MATERIAL: 'Raw Material',
  COMPONENT: 'Component',
  SUBASSEMBLY: 'Subassembly',
  FINISHED_GOOD: 'Finished Good',
  CONSUMABLE: 'Consumable',
};

export interface Item {
  id: string;
  itemCode: string;
  name: string;
  description: string | null;
  itemType: ItemType;
  baseUnitOfMeasure: string;
  isActive: boolean;
  defaultWastagePercent: string | null;
  drawingSpecReference: string | null;
  standardLeadTimeDays: number | null;
  manualStandardCost?: string | null;
  currentCost?: string | null;
  costSource?: 'LATEST_ACCEPTED_GRN' | 'LATEST_AWARDED_QUOTE' | 'MANUAL_STANDARD' | null;
  releasedBomCostSnapshot?: string | null;
  createdAt: string;
  updatedAt: string;
}

/** itemCode is server-generated from itemType — never sent by the client. */
export interface CreateItemInput {
  name: string;
  description?: string;
  itemType: ItemType;
  baseUnitOfMeasure: string;
  isActive?: boolean;
  defaultWastagePercent?: number;
  drawingSpecReference?: string;
  standardLeadTimeDays?: number;
  manualStandardCost?: number;
}

export type UpdateItemInput = Partial<CreateItemInput>;

/** Preview the itemCode a create would currently receive for this type — does
 * not consume a sequence value. Shown read-only on the New Item form. */
export function previewNextItemCode(itemType: ItemType) {
  return apiFetch<string>(`/items/next-code?itemType=${itemType}`);
}

export function listItems(opts: { search?: string; activeOnly?: boolean } = {}) {
  const qs = new URLSearchParams();
  if (opts.search) qs.set('search', opts.search);
  if (opts.activeOnly) qs.set('activeOnly', 'true');
  const q = qs.toString();
  return apiFetch<Item[]>(`/items${q ? `?${q}` : ''}`);
}

export function getItem(id: string) {
  return apiFetch<Item>(`/items/${id}`);
}

export function createItem(input: CreateItemInput) {
  return apiFetch<Item>('/items', { method: 'POST', body: JSON.stringify(input) });
}

export function updateItem(id: string, input: UpdateItemInput) {
  return apiFetch<Item>(`/items/${id}`, { method: 'PATCH', body: JSON.stringify(input) });
}

export function updateItemCost(id: string, manualStandardCost: number | null) {
  return apiFetch<Item>(`/items/${id}/cost`, {
    method: 'PATCH',
    body: JSON.stringify({ manualStandardCost }),
  });
}

export function deactivateItem(id: string) {
  return apiFetch<Item>(`/items/${id}`, { method: 'DELETE' });
}

export function mergeItems(canonicalItemId: string, duplicateItemId: string) {
  return apiFetch<{
    canonicalItemId: string;
    duplicateItemId: string;
    duplicateDeactivated: boolean;
    affectedBomLines: number;
  }>('/items/merge', {
    method: 'POST',
    body: JSON.stringify({ canonicalItemId, duplicateItemId }),
  });
}
