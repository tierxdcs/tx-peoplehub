import {
  classify,
  computeTotalScore,
  TOTAL_MAX_SCORE,
  classificationToSupplierStatus,
  supplierStatusToClassification,
  isClassificationStatus,
  CLASSIFICATION_STATUSES,
  AUDIT_SCORE_KEYS,
} from './supplier-scoring';

describe('supplier-scoring', () => {
  it('six weights sum to exactly 100', () => {
    expect(TOTAL_MAX_SCORE).toBe(100);
    expect(AUDIT_SCORE_KEYS).toHaveLength(6);
  });

  it('classifies at the exact threshold boundaries', () => {
    expect(classify(90)).toBe('APPROVED_PREFERRED');
    expect(classify(89)).toBe('APPROVED');
    expect(classify(80)).toBe('APPROVED');
    expect(classify(79)).toBe('CONDITIONALLY_APPROVED');
    expect(classify(70)).toBe('CONDITIONALLY_APPROVED');
    expect(classify(69)).toBe('NOT_APPROVED');
    expect(classify(100)).toBe('APPROVED_PREFERRED');
    expect(classify(0)).toBe('NOT_APPROVED');
  });

  it('sums Decimal-string scores across the six categories', () => {
    // 28+14+18+13+9+8 = 90
    expect(
      computeTotalScore({
        materialCertificationsQualityScore: '28',
        complianceScore: '14',
        commercialTermsScore: '18',
        logisticsDeliveryScore: '13',
        financialStabilityScore: '9',
        referencesScore: '8',
      }),
    ).toBe(90);
  });

  it('maps classifications to supplier statuses', () => {
    expect(classificationToSupplierStatus('APPROVED_PREFERRED')).toBe('APPROVED_PREFERRED');
    expect(classificationToSupplierStatus('APPROVED')).toBe('APPROVED');
    expect(classificationToSupplierStatus('CONDITIONALLY_APPROVED')).toBe('CONDITIONALLY_APPROVED');
    expect(classificationToSupplierStatus('NOT_APPROVED')).toBe('NOT_APPROVED');
  });

  it('recognises the four classification-valued statuses (override targets)', () => {
    expect(CLASSIFICATION_STATUSES).toEqual([
      'APPROVED_PREFERRED',
      'APPROVED',
      'CONDITIONALLY_APPROVED',
      'NOT_APPROVED',
    ]);
    for (const s of CLASSIFICATION_STATUSES) {
      expect(isClassificationStatus(s)).toBe(true);
    }
    expect(isClassificationStatus('PENDING_QUESTIONNAIRE')).toBe(false);
    expect(isClassificationStatus('QUESTIONNAIRE_SUBMITTED')).toBe(false);
    expect(isClassificationStatus('UNDER_AUDIT')).toBe(false);
  });

  it('narrows a classification-valued status back to a classification (override display)', () => {
    expect(supplierStatusToClassification('APPROVED_PREFERRED')).toBe('APPROVED_PREFERRED');
    expect(supplierStatusToClassification('APPROVED')).toBe('APPROVED');
    expect(supplierStatusToClassification('CONDITIONALLY_APPROVED')).toBe('CONDITIONALLY_APPROVED');
    expect(supplierStatusToClassification('NOT_APPROVED')).toBe('NOT_APPROVED');
    expect(supplierStatusToClassification('PENDING_QUESTIONNAIRE')).toBeNull();
  });
});
