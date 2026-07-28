import {
  PLM_PRODUCTION_STEP_COUNT,
  PLM_PRODUCTION_STEPS,
  stepsToPercent,
} from './plm-production-steps';

describe('plm-production-steps', () => {
  it('has the fixed 9-step fabrication routing in order', () => {
    expect(PLM_PRODUCTION_STEPS).toEqual([
      'Material',
      'Cut',
      'Punch',
      'Bend',
      'Weld',
      'Coat',
      'Assemble',
      'QC',
      'Pack',
    ]);
    expect(PLM_PRODUCTION_STEP_COUNT).toBe(9);
  });

  it('derives percent from completed steps', () => {
    expect(stepsToPercent(0)).toBe(0);
    expect(stepsToPercent(9)).toBe(100);
    expect(stepsToPercent(5)).toBe(56); // 5/9 = 55.5 → 56
    expect(stepsToPercent(6)).toBe(67); // matches the reference "67%"
  });

  it('clamps out-of-range counts', () => {
    expect(stepsToPercent(-3)).toBe(0);
    expect(stepsToPercent(99)).toBe(100);
  });
});
