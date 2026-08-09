'use client';

import { apiFetch } from './api';

/**
 * SCM Resource Planning Sheet client. Money/quantity values are Decimal-as-
 * string. Variance sign: POSITIVE = negotiated above benchmark (cost increase),
 * NEGATIVE = saving; variance* is null on lines with no negotiated price yet.
 */

export interface ResourcePlanLine {
  id: string;
  itemId: string;
  itemCode: string;
  itemName: string;
  requiredQuantity: string;
  unitOfMeasure: string;
  benchmarkCostPerUnit: string;
  negotiatedPricePerUnit: string | null;
  notes: string | null;
  benchmarkLineTotal: string;
  negotiatedLineTotal: string | null;
  varianceAmount: string | null;
  variancePercent: string | null;
}

export interface ResourcePlanSummary {
  totalBenchmarkCost: string;
  totalNegotiatedCost: string;
  varianceAmount: string;
  variancePercent: string | null;
  lineCount: number;
  negotiatedLineCount: number;
}

export interface ResourcePlan {
  id: string;
  projectKickoffId: string;
  projectName: string;
  orderId: string;
  orderNumber: string;
  generatedAt: string;
  generatedById: string;
  generatedByName: string | null;
  lines: ResourcePlanLine[];
  summary: ResourcePlanSummary;
}

export interface EligibleProject {
  projectKickoffId: string;
  projectName: string;
  orderId: string;
  orderNumber: string;
  customerName: string;
  hasPlan: boolean;
  planId: string | null;
  generatedAt: string | null;
  totalBenchmarkCost: string | null;
  totalNegotiatedCost: string | null;
  varianceAmount: string | null;
  variancePercent: string | null;
}

export interface CrossProjectSummaryRow {
  planId: string;
  projectKickoffId: string;
  projectName: string;
  orderNumber: string;
  customerName: string;
  generatedAt: string;
  totalBenchmarkCost: string;
  totalNegotiatedCost: string;
  varianceAmount: string;
  variancePercent: string | null;
  lineCount: number;
  negotiatedLineCount: number;
}

export interface UpdateResourcePlanLineInput {
  negotiatedPricePerUnit?: number | null;
  notes?: string | null;
}

export function listEligibleProjects() {
  return apiFetch<EligibleProject[]>('/scm/resource-plans/projects');
}

export function getResourcePlan(kickoffId: string) {
  return apiFetch<ResourcePlan | null>(
    `/scm/resource-plans/projects/${kickoffId}`,
  );
}

export function generateResourcePlan(kickoffId: string) {
  return apiFetch<ResourcePlan>(
    `/scm/resource-plans/projects/${kickoffId}/generate`,
    { method: 'POST' },
  );
}

export function updateResourcePlanLine(
  lineId: string,
  input: UpdateResourcePlanLineInput,
) {
  return apiFetch<ResourcePlanLine>(`/scm/resource-plans/lines/${lineId}`, {
    method: 'PATCH',
    body: JSON.stringify(input),
  });
}

export function crossProjectSummary() {
  return apiFetch<CrossProjectSummaryRow[]>('/scm/resource-plans/summary');
}

/**
 * Semantic colour class for a cost variance, matching the system-wide delta
 * convention: an INCREASE (positive) is destructive, a SAVING (negative) is
 * success, exactly zero (or null) is muted. Amount may be a string or number.
 */
export function varianceToneClass(
  amount: string | number | null | undefined,
): string {
  if (amount === null || amount === undefined || amount === '') {
    return 'text-muted-foreground';
  }
  const n = typeof amount === 'number' ? amount : Number(amount);
  if (Number.isNaN(n) || n === 0) return 'text-muted-foreground';
  return n > 0 ? 'text-destructive' : 'text-success';
}

/** Signed money label for a variance, e.g. "+₹1,200.00" / "−₹800.00". */
export function signedVariance(
  amount: string | number | null | undefined,
  format: (v: string | number) => string,
): string {
  if (amount === null || amount === undefined || amount === '') return '—';
  const n = typeof amount === 'number' ? amount : Number(amount);
  if (Number.isNaN(n)) return '—';
  const prefix = n > 0 ? '+' : n < 0 ? '−' : '';
  return `${prefix}${format(Math.abs(n))}`;
}
