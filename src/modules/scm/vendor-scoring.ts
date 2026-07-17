import { VendorStatus } from '@prisma/client';

/**
 * Vendor audit scoring — the 10 weighted categories from the VSAQ's Internal
 * Evaluation table (maxes sum to 100) and the classification thresholds. Pure
 * functions, unit-tested at the boundary values (89/90, 79/80, 69/70).
 *
 * Thresholds (exactly the reference form's logic):
 *   90–100 → Approved (Preferred Vendor)
 *   80–89  → Approved
 *   70–79  → Conditionally Approved (Improvement Plan Required)
 *   <70    → Not Approved
 */

/** The 10 score fields and their maximums (order = display order). */
export const AUDIT_SCORE_MAXES = {
  manufacturingCapabilityScore: 20,
  capacityScore: 10,
  qualitySystemScore: 20,
  engineeringScore: 10,
  financialStabilityScore: 5,
  supplyChainScore: 10,
  exportReadinessScore: 10,
  sustainabilityScore: 5,
  ehsScore: 5,
  customerReferencesScore: 5,
} as const;

export type AuditScoreKey = keyof typeof AUDIT_SCORE_MAXES;

export const AUDIT_SCORE_KEYS = Object.keys(
  AUDIT_SCORE_MAXES,
) as AuditScoreKey[];

/** Sanity check that the weights sum to 100 (guards against a typo above). */
export const TOTAL_MAX_SCORE = AUDIT_SCORE_KEYS.reduce(
  (sum, k) => sum + AUDIT_SCORE_MAXES[k],
  0,
);

export type VendorClassification =
  | 'APPROVED_PREFERRED'
  | 'APPROVED'
  | 'CONDITIONALLY_APPROVED'
  | 'NOT_APPROVED';

/** Sum the 10 category scores (each accepts number|string, as Decimals arrive). */
export function computeTotalScore(
  scores: Record<AuditScoreKey, number | string>,
): number {
  return AUDIT_SCORE_KEYS.reduce((sum, k) => {
    const n = typeof scores[k] === 'number' ? scores[k] : Number(scores[k]);
    return sum + (Number.isFinite(n as number) ? (n as number) : 0);
  }, 0);
}

/** Classification from a total. Boundaries are inclusive-low: 90/80/70. */
export function classify(total: number): VendorClassification {
  if (total >= 90) return 'APPROVED_PREFERRED';
  if (total >= 80) return 'APPROVED';
  if (total >= 70) return 'CONDITIONALLY_APPROVED';
  return 'NOT_APPROVED';
}

/** Human label for a classification (matches the reference form's wording). */
export const CLASSIFICATION_LABEL: Record<VendorClassification, string> = {
  APPROVED_PREFERRED: 'Approved (Preferred Vendor)',
  APPROVED: 'Approved',
  CONDITIONALLY_APPROVED: 'Conditionally Approved (Improvement Plan Required)',
  NOT_APPROVED: 'Not Approved',
};

/**
 * The classification maps 1:1 onto a VendorStatus for the finalized audit —
 * finalizing an audit sets Vendor.status to this.
 */
export function classificationToVendorStatus(
  c: VendorClassification,
): VendorStatus {
  switch (c) {
    case 'APPROVED_PREFERRED':
      return VendorStatus.APPROVED_PREFERRED;
    case 'APPROVED':
      return VendorStatus.APPROVED;
    case 'CONDITIONALLY_APPROVED':
      return VendorStatus.CONDITIONALLY_APPROVED;
    case 'NOT_APPROVED':
      return VendorStatus.NOT_APPROVED;
  }
}
