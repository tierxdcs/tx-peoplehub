import { describe, expect, it } from 'vitest';
import { flowForVertical, VERTICAL_FLOWS } from './process-flows';

describe('canonical employee process flows', () => {
  it('carries every process family with learning detail', () => {
    // Seven per-vertical flows plus the cross-cutting sub-processes.
    expect(VERTICAL_FLOWS.length).toBeGreaterThanOrEqual(7);
    for (const flow of VERTICAL_FLOWS) {
      expect(flow.summary.length).toBeGreaterThan(20);
      expect(flow.participants.length).toBeGreaterThan(10);
      expect(flow.steps.length).toBeGreaterThan(3);
      // Details are now multi-sentence explanations, not one-liners.
      expect(flow.steps.every((step) => step.detail.length > 40)).toBe(true);
    }
  });

  it('keeps the seven per-vertical flows first so flowForVertical maps correctly', () => {
    const verticalCodes = [
      'SALES',
      'RND',
      'SCM',
      'PRODUCTION',
      'QMS',
      'ACCOUNTS',
      'HR',
    ];
    for (const code of verticalCodes) {
      expect(flowForVertical(code)).not.toBeNull();
    }
  });

  it('gives every flow a unique primary code (pill / dashboard key)', () => {
    const primaryCodes = VERTICAL_FLOWS.map((f) => f.codes[0]);
    expect(new Set(primaryCodes).size).toBe(primaryCodes.length);
  });

  it('uses the same canonical Sales data wherever Sales guidance is requested', () => {
    expect(flowForVertical('SALES')).toBe(VERTICAL_FLOWS[0]);
  });
});
