import { describe, expect, it } from 'vitest';
import {
  configureReferenceCurrency,
  formatApproximateReference,
} from './reference-currency';

describe('reference currency display', () => {
  it('does not add a reference for INR', () => {
    configureReferenceCurrency('INR', { USD: 0.012 });
    expect(formatApproximateReference(1000, 'india')).toBeNull();
  });

  it('converts using the supplied cached rate and marks it approximate', () => {
    configureReferenceCurrency('USD', { USD: 0.012 });
    expect(formatApproximateReference(1000, 'international')).toBe(
      'approx $12.00 USD',
    );
  });

  it('falls back cleanly when a selected rate is unavailable', () => {
    configureReferenceCurrency('EUR', {});
    expect(formatApproximateReference(1000, 'india')).toBeNull();
  });
});
