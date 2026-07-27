'use client';

import { createContext, useCallback, useContext, useEffect, useState } from 'react';

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

const NumberFormatContext = createContext<{
  style: NumberFormatStyle;
  setStyle: (next: NumberFormatStyle) => void;
} | null>(null);

export function NumberFormatProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [style, setStyleState] = useState<NumberFormatStyle>('india');

  // Read the persisted choice after mount only (SSR has no localStorage) —
  // matches next-themes's own hydration-safe pattern.
  useEffect(() => {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (stored === 'india' || stored === 'international') {
      setStyleState(stored);
    }
  }, []);

  const setStyle = useCallback((next: NumberFormatStyle) => {
    setStyleState(next);
    window.localStorage.setItem(STORAGE_KEY, next);
  }, []);

  return (
    <NumberFormatContext.Provider value={{ style, setStyle }}>
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
