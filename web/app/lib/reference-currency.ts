export type ReferenceCurrency = 'INR' | 'USD' | 'CAD' | 'EUR';
export type ReferenceRates = Partial<
  Record<Exclude<ReferenceCurrency, 'INR'>, number>
>;

let selectedCurrency: ReferenceCurrency = 'INR';
let cachedRates: ReferenceRates = {};

export function configureReferenceCurrency(
  currency: ReferenceCurrency,
  rates: ReferenceRates,
) {
  selectedCurrency = currency;
  cachedRates = rates;
}

export function formatApproximateReference(
  inrAmount: number,
  style: 'india' | 'international',
): string | null {
  if (selectedCurrency === 'INR') return null;
  const rate = cachedRates[selectedCurrency];
  if (!rate || !Number.isFinite(rate)) return null;

  const locale = style === 'india' ? 'en-IN' : 'en-US';
  const converted = new Intl.NumberFormat(locale, {
    style: 'currency',
    currency: selectedCurrency,
    maximumFractionDigits: 2,
  }).format(inrAmount * rate);
  return `approx ${converted} ${selectedCurrency}`;
}
