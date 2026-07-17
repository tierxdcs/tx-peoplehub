import { SupplierStatus } from '@prisma/client';

/**
 * Supplier (raw-materials) audit scoring — six weighted categories summing to
 * 100, distinct from Vendor's ten. Classification thresholds are the SAME as
 * Vendor (90/80/70) — kept consistent deliberately. Pure, boundary-tested.
 *
 *   90–100 → Approved (Preferred Supplier)
 *   80–89  → Approved
 *   70–79  → Conditionally Approved (Improvement Plan Required)
 *   <70    → Not Approved
 */

export const AUDIT_SCORE_MAXES = {
  materialCertificationsQualityScore: 30,
  complianceScore: 15,
  commercialTermsScore: 20,
  logisticsDeliveryScore: 15,
  financialStabilityScore: 10,
  referencesScore: 10,
} as const;

export type AuditScoreKey = keyof typeof AUDIT_SCORE_MAXES;

export const AUDIT_SCORE_KEYS = Object.keys(
  AUDIT_SCORE_MAXES,
) as AuditScoreKey[];

/** Guards against a weight typo — must be 100. */
export const TOTAL_MAX_SCORE = AUDIT_SCORE_KEYS.reduce(
  (sum, k) => sum + AUDIT_SCORE_MAXES[k],
  0,
);

export type SupplierClassification =
  | 'APPROVED_PREFERRED'
  | 'APPROVED'
  | 'CONDITIONALLY_APPROVED'
  | 'NOT_APPROVED';

export function computeTotalScore(
  scores: Record<AuditScoreKey, number | string>,
): number {
  return AUDIT_SCORE_KEYS.reduce((sum, k) => {
    const n = typeof scores[k] === 'number' ? scores[k] : Number(scores[k]);
    return sum + (Number.isFinite(n as number) ? (n as number) : 0);
  }, 0);
}

/** Boundaries inclusive-low: 90/80/70. */
export function classify(total: number): SupplierClassification {
  if (total >= 90) return 'APPROVED_PREFERRED';
  if (total >= 80) return 'APPROVED';
  if (total >= 70) return 'CONDITIONALLY_APPROVED';
  return 'NOT_APPROVED';
}

export const CLASSIFICATION_LABEL: Record<SupplierClassification, string> = {
  APPROVED_PREFERRED: 'Approved (Preferred Supplier)',
  APPROVED: 'Approved',
  CONDITIONALLY_APPROVED: 'Conditionally Approved (Improvement Plan Required)',
  NOT_APPROVED: 'Not Approved',
};

export function classificationToSupplierStatus(
  c: SupplierClassification,
): SupplierStatus {
  switch (c) {
    case 'APPROVED_PREFERRED':
      return SupplierStatus.APPROVED_PREFERRED;
    case 'APPROVED':
      return SupplierStatus.APPROVED;
    case 'CONDITIONALLY_APPROVED':
      return SupplierStatus.CONDITIONALLY_APPROVED;
    case 'NOT_APPROVED':
      return SupplierStatus.NOT_APPROVED;
  }
}
