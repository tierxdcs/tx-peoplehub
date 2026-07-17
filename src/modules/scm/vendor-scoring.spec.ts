import {
  classify,
  computeTotalScore,
  TOTAL_MAX_SCORE,
  classificationToVendorStatus,
  AUDIT_SCORE_KEYS,
} from './vendor-scoring';

describe('vendor-scoring', () => {
  it('weights sum to exactly 100', () => {
    expect(TOTAL_MAX_SCORE).toBe(100);
    expect(AUDIT_SCORE_KEYS).toHaveLength(10);
  });

  it('classifies exactly at the threshold boundaries', () => {
    // 90 boundary
    expect(classify(90)).toBe('APPROVED_PREFERRED');
    expect(classify(89)).toBe('APPROVED');
    // 80 boundary
    expect(classify(80)).toBe('APPROVED');
    expect(classify(79)).toBe('CONDITIONALLY_APPROVED');
    // 70 boundary
    expect(classify(70)).toBe('CONDITIONALLY_APPROVED');
    expect(classify(69)).toBe('NOT_APPROVED');
    // extremes
    expect(classify(100)).toBe('APPROVED_PREFERRED');
    expect(classify(0)).toBe('NOT_APPROVED');
  });

  it('sums Decimal-string scores', () => {
    const scores = {
      manufacturingCapabilityScore: '18',
      capacityScore: '9',
      qualitySystemScore: '19',
      engineeringScore: '9',
      financialStabilityScore: '5',
      supplyChainScore: '9',
      exportReadinessScore: '9',
      sustainabilityScore: '4',
      ehsScore: '4',
      customerReferencesScore: '4',
    };
    // 18+9+19+9+5+9+9+4+4+4 = 90
    expect(computeTotalScore(scores)).toBe(90);
    expect(classify(computeTotalScore(scores))).toBe('APPROVED_PREFERRED');
  });

  it('maps each classification to a vendor status', () => {
    expect(classificationToVendorStatus('APPROVED_PREFERRED')).toBe(
      'APPROVED_PREFERRED',
    );
    expect(classificationToVendorStatus('APPROVED')).toBe('APPROVED');
    expect(classificationToVendorStatus('CONDITIONALLY_APPROVED')).toBe(
      'CONDITIONALLY_APPROVED',
    );
    expect(classificationToVendorStatus('NOT_APPROVED')).toBe('NOT_APPROVED');
  });
});
