import { describe, expect, it } from 'vitest';
import {
  configureReferenceCurrency,
  formatApproximateReference,
  formatInSelectedCurrency,
  resolveDisplayCurrency,
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

describe('single-currency proposal display', () => {
  it('renders INR alone when INR is selected, honouring the grouping style', () => {
    configureReferenceCurrency('INR', {});
    expect(resolveDisplayCurrency()).toBe('INR');
    expect(formatInSelectedCurrency(1410000, 'india')).toBe('₹14,10,000.00');
    expect(formatInSelectedCurrency(1410000, 'international')).toBe(
      '₹1,410,000.00',
    );
  });

  it('renders the foreign currency alone (no ₹) at the cached rate', () => {
    configureReferenceCurrency('USD', { USD: 0.012 });
    expect(resolveDisplayCurrency()).toBe('USD');
    // No "₹… (approx …)" — a single value that fits the column.
    expect(formatInSelectedCurrency(1000, 'india')).toBe('$12.00');
  });

  it('falls back to INR when the selected rate is unavailable', () => {
    configureReferenceCurrency('EUR', {});
    expect(resolveDisplayCurrency()).toBe('INR');
    expect(formatInSelectedCurrency(1000, 'india')).toBe('₹1,000.00');
  });
});
