import { describe, expect, it } from 'vitest';
import { flowForVertical, VERTICAL_FLOWS } from './process-flows';

describe('canonical employee process flows', () => {
  it('contains the seven employee-facing process families with learning detail', () => {
    expect(VERTICAL_FLOWS).toHaveLength(7);
    for (const flow of VERTICAL_FLOWS) {
      expect(flow.summary.length).toBeGreaterThan(20);
      expect(flow.participants.length).toBeGreaterThan(10);
      expect(flow.steps.length).toBeGreaterThan(3);
      expect(flow.steps.every((step) => step.detail.length > 5)).toBe(true);
    }
  });

  it('uses the same canonical Sales data wherever Sales guidance is requested', () => {
    expect(flowForVertical('SALES')).toBe(VERTICAL_FLOWS[0]);
  });
});
