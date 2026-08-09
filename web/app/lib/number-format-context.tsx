'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from 'react';
import { apiFetch } from './api';
import {
  configureReferenceCurrency,
  type ReferenceCurrency,
  type ReferenceRates,
} from './reference-currency';

/**
 * Digit-grouping style for ₹ amounts — cosmetic only, same currency and same
 * underlying value either way:
 *   - india:         ₹14,10,000.00  (lakh/crore grouping, en-IN)
 *   - international: ₹1,410,000.00 (thousands grouping, en-US)
 * Persisted client-side, mirroring the AppThemeProvider/next-themes pattern
 * (localStorage-backed, no server round-trip).
 */
export type NumberFormatStyle = 'india' | 'international';

const STORAGE_KEY = 'phaze-erp-number-format';
const CURRENCY_STORAGE_KEY = 'phaze-erp-reference-currency';

const NumberFormatContext = createContext<{
  style: NumberFormatStyle;
  setStyle: (next: NumberFormatStyle) => void;
  currency: ReferenceCurrency;
  setCurrency: (next: ReferenceCurrency) => void;
  ratesAvailable: boolean;
  ratesFetchedAt: string | null;
} | null>(null);

export function NumberFormatProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [style, setStyleState] = useState<NumberFormatStyle>('india');
  const [currency, setCurrencyState] = useState<ReferenceCurrency>('INR');
  const [rates, setRates] = useState<ReferenceRates>({});
  const [ratesFetchedAt, setRatesFetchedAt] = useState<string | null>(null);

  // Read the persisted choice after mount only (SSR has no localStorage) —
  // matches next-themes's own hydration-safe pattern.
  useEffect(() => {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (stored === 'india' || stored === 'international') {
      setStyleState(stored);
    }
    const storedCurrency = window.localStorage.getItem(CURRENCY_STORAGE_KEY);
    if (['INR', 'USD', 'CAD', 'EUR'].includes(storedCurrency ?? '')) {
      setCurrencyState(storedCurrency as ReferenceCurrency);
    }
  }, []);

  useEffect(() => {
    configureReferenceCurrency(currency, rates);
    if (currency === 'INR' || Object.keys(rates).length) return;
    apiFetch<{
      rates: ReferenceRates;
      fetchedAt: string | null;
      available: boolean;
    }>('/reference-rates')
      .then((snapshot) => {
        if (!snapshot.available) return;
        setRates(snapshot.rates);
        setRatesFetchedAt(snapshot.fetchedAt);
        configureReferenceCurrency(currency, snapshot.rates);
      })
      // Reference conversion must never interrupt authoritative INR display.
      .catch(() => undefined);
  }, [currency, rates]);

  const setStyle = useCallback((next: NumberFormatStyle) => {
    setStyleState(next);
    window.localStorage.setItem(STORAGE_KEY, next);
  }, []);

  const setCurrency = useCallback((next: ReferenceCurrency) => {
    setCurrencyState(next);
    window.localStorage.setItem(CURRENCY_STORAGE_KEY, next);
  }, []);

  // Keep the existing pure formatINR call sites synchronized without passing
  // reference-display settings into business or calculation functions.
  configureReferenceCurrency(currency, rates);

  return (
    <NumberFormatContext.Provider
      value={{
        style,
        setStyle,
        currency,
        setCurrency,
        ratesAvailable: currency === 'INR' || Boolean(rates[currency]),
        ratesFetchedAt,
      }}
    >
      {children}
    </NumberFormatContext.Provider>
  );
}

export function useNumberFormat() {
  const ctx = useContext(NumberFormatContext);
  if (!ctx) {
    throw new Error('useNumberFormat must be used within NumberFormatProvider');
  }
  return ctx;
}
