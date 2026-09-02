import { describe, expect, it } from 'vitest';
import {
  COMPANY_GST_STATE_CODE,
  DEFAULT_GST_RATE,
  GST_STATES,
  gstSplitWarning,
  gstStateByCode,
  gstStateByName,
  isIntraStateSupply,
  splitGstRate,
} from './gst-states';

describe('GST state table', () => {
  // Mirrors src/modules/finance-ar/gst-states.spec.ts — the same invariants are
  // asserted on both copies, since the Nest and Next builds share no module.
  it('holds every state and union territory exactly once, as two-digit codes', () => {
    expect(GST_STATES).toHaveLength(37);
    expect(new Set(GST_STATES.map((s) => s.code)).size).toBe(GST_STATES.length);
    for (const state of GST_STATES) expect(state.code).toMatch(/^\d{2}$/);
  });

  it('is sorted by name so the dropdown renders it as-is', () => {
    const names = GST_STATES.map((s) => s.name);
    expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b)));
  });

  it('omits the codes GSTN retired', () => {
    expect(gstStateByCode('25')).toBeUndefined();
    expect(gstStateByCode('28')).toBeUndefined();
  });

  it('looks a state up by name, case- and space-insensitively', () => {
    expect(gstStateByName('  karnataka ')?.code).toBe('29');
    expect(gstStateByName('Not A State')).toBeUndefined();
  });
});

describe('splitGstRate', () => {
  it('halves the rate into CGST and SGST for the company’s own state', () => {
    expect(isIntraStateSupply(COMPANY_GST_STATE_CODE)).toBe(true);
    expect(splitGstRate(DEFAULT_GST_RATE, '29')).toEqual({
      igstRate: 0,
      cgstRate: 9,
      sgstRate: 9,
    });
  });

  it('puts the whole rate on IGST for every other state', () => {
    expect(splitGstRate(DEFAULT_GST_RATE, '33')).toEqual({
      igstRate: 18,
      cgstRate: 0,
      sgstRate: 0,
    });
  });

  it('preserves the preparer’s slab rather than resetting to 18', () => {
    // A 28% invoice moved from Kerala to Karnataka stays a 28% invoice.
    expect(splitGstRate(28, '29')).toEqual({
      igstRate: 0,
      cgstRate: 14,
      sgstRate: 14,
    });
    // An odd slab halves to a clean two-decimal rate, not a binary tail.
    expect(splitGstRate(5, '29')).toEqual({
      igstRate: 0,
      cgstRate: 2.5,
      sgstRate: 2.5,
    });
  });

  it('leaves an exempt supply at zero instead of forcing a default rate', () => {
    expect(splitGstRate(0, '29')).toEqual({
      igstRate: 0,
      cgstRate: 0,
      sgstRate: 0,
    });
    expect(splitGstRate(Number.NaN, '33')).toEqual({
      igstRate: 0,
      cgstRate: 0,
      sgstRate: 0,
    });
  });
});

describe('gstSplitWarning', () => {
  const split = (over: Partial<ReturnType<typeof splitGstRate>> = {}) => ({
    igstRate: 0,
    cgstRate: 0,
    sgstRate: 0,
    ...over,
  });

  it('passes a split that matches the place of supply', () => {
    expect(
      gstSplitWarning('29', split({ cgstRate: 9, sgstRate: 9 })),
    ).toBeNull();
    expect(gstSplitWarning('33', split({ igstRate: 18 }))).toBeNull();
    // A zero-rated supply contradicts nothing.
    expect(gstSplitWarning('29', split())).toBeNull();
  });

  it('flags IGST charged on an intra-state supply', () => {
    expect(gstSplitWarning('29', split({ igstRate: 18 }))).toMatch(
      /Karnataka.*intra-state.*CGST \+ SGST/,
    );
  });

  it('flags CGST/SGST charged on an inter-state supply', () => {
    expect(gstSplitWarning('33', split({ cgstRate: 9, sgstRate: 9 }))).toMatch(
      /Tamil Nadu.*inter-state.*IGST/,
    );
  });

  it('flags IGST and CGST/SGST on the same invoice ahead of either state rule', () => {
    expect(
      gstSplitWarning('29', split({ igstRate: 18, cgstRate: 9, sgstRate: 9 })),
    ).toMatch(/either inter-state.*or intra-state/);
  });

  it('flags unequal CGST and SGST, which the server refuses outright', () => {
    expect(gstSplitWarning('29', split({ cgstRate: 9, sgstRate: 8 }))).toMatch(
      /equal halves/,
    );
  });
});
