import { deriveVendorCadence } from './plm-vendor-cadence';

describe('deriveVendorCadence', () => {
  const reference = new Date('2026-07-25T00:00:00.000Z');

  it('is green while comfortably within cadence', () => {
    expect(
      deriveVendorCadence(reference, 1, new Date('2026-07-25T12:00:00.000Z'))
        .status,
    ).toBe('GREEN');
  });

  it('is amber once 75 percent of the cadence has elapsed', () => {
    expect(
      deriveVendorCadence(reference, 1, new Date('2026-07-25T18:00:00.000Z'))
        .status,
    ).toBe('AMBER');
  });

  it('is red once the configured cadence is overdue', () => {
    expect(
      deriveVendorCadence(reference, 2, new Date('2026-07-27T00:00:00.000Z'))
        .status,
    ).toBe('RED');
  });
});
