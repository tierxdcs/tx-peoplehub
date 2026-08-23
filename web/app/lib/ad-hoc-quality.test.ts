import { describe, expect, it } from 'vitest';
import { adHocBundleWarning } from './ad-hoc-quality';

describe('adHocBundleWarning — bundle smells in ad-hoc product names', () => {
  it('accepts clean single-product names', () => {
    expect(adHocBundleWarning('PowerBase 32 2UH')).toBeNull();
    expect(adHocBundleWarning('Floor Mount Rack 42U')).toBeNull();
    expect(adHocBundleWarning('Liquid Cooling LC25')).toBeNull();
    expect(adHocBundleWarning('')).toBeNull();
    expect(adHocBundleWarning('   ')).toBeNull();
  });

  it('flags names joined with +, & or "and"', () => {
    expect(adHocBundleWarning('Kiosk + PDU')).toMatch(/several products/);
    expect(adHocBundleWarning('Rack & cabling')).toMatch(/several products/);
    expect(adHocBundleWarning('Enclosure and busbar')).toMatch(/'and'/);
  });

  it('does not treat "and" inside a word as a joiner', () => {
    expect(adHocBundleWarning('Standard Enclosure')).toBeNull();
    expect(adHocBundleWarning('Command Panel')).toBeNull();
  });

  it('flags comma-separated lists', () => {
    expect(adHocBundleWarning('Kiosk, PDU, rack')).toMatch(/comma-separated/);
  });

  it('flags multiple quantity mentions but allows a single one', () => {
    expect(adHocBundleWarning('2x PDU and 3 nos racks')).toMatch(/quantity/);
    expect(adHocBundleWarning('Busbar 2x rail 3 sets')).toMatch(/quantity/);
    // A single quantity token alone is not a bundle signal.
    expect(adHocBundleWarning('PDU 3 nos')).toBeNull();
  });
});
