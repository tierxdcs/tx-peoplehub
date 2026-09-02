import {
  COMPANY_GST_STATE_CODE,
  GST_STATES,
  gstStateByCode,
  isIntraStateSupply,
  resolvePlaceOfSupply,
} from './gst-states';

describe('GST state codes', () => {
  // The table is hand-typed from the GSTN list, so guard the properties a typo
  // would break rather than re-listing all 37 rows.
  it('holds every state and union territory exactly once', () => {
    expect(GST_STATES).toHaveLength(37);
    expect(new Set(GST_STATES.map((s) => s.code)).size).toBe(GST_STATES.length);
    expect(new Set(GST_STATES.map((s) => s.name)).size).toBe(GST_STATES.length);
  });

  it('stores every code as two digits', () => {
    for (const state of GST_STATES) expect(state.code).toMatch(/^\d{2}$/);
  });

  it('is sorted by name so the mirrored dropdown needs no re-sort', () => {
    const names = GST_STATES.map((s) => s.name);
    expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b)));
  });

  it('omits the codes GSTN retired', () => {
    // 25 merged into 26 in 2020; 28 was bifurcated into 36 and 37. Offering
    // either would let a preparer pick a code the IRP refuses.
    expect(gstStateByCode('25')).toBeUndefined();
    expect(gstStateByCode('28')).toBeUndefined();
    expect(gstStateByCode('26')?.name).toBe(
      'Dadra and Nagar Haveli and Daman and Diu',
    );
    expect(gstStateByCode('37')?.name).toBe('Andhra Pradesh');
  });

  it('treats only the company state as an intra-state supply', () => {
    expect(gstStateByCode(COMPANY_GST_STATE_CODE)?.name).toBe('Karnataka');
    expect(isIntraStateSupply('29')).toBe(true);
    expect(isIntraStateSupply('33')).toBe(false);
    expect(isIntraStateSupply('')).toBe(false);
  });

  describe('resolvePlaceOfSupply', () => {
    it('accepts a matching pair and returns GSTN’s own spelling', () => {
      expect(resolvePlaceOfSupply('karnataka', '29')).toEqual({
        code: '29',
        name: 'Karnataka',
      });
      expect(resolvePlaceOfSupply('  Tamil Nadu  ', '33')?.name).toBe(
        'Tamil Nadu',
      );
    });

    it('rejects a name that belongs to a different code', () => {
      expect(resolvePlaceOfSupply('Karnataka', '33')).toBeNull();
    });

    it('rejects an unknown or retired code', () => {
      expect(resolvePlaceOfSupply('Karnataka', '99')).toBeNull();
      expect(resolvePlaceOfSupply('Daman and Diu', '25')).toBeNull();
    });
  });
});
