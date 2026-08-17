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

/**
 * The currency a single-currency document (e.g. the printed proposal) should
 * actually render in: the selected reference currency when a live rate is
 * available, otherwise INR (which is always authoritative). Keeping this
 * resolution in one place means the numbers and their column headers can never
 * disagree about which currency is on the page.
 */
export function resolveDisplayCurrency(): ReferenceCurrency {
  if (selectedCurrency === 'INR') return 'INR';
  const rate = cachedRates[selectedCurrency];
  return rate && Number.isFinite(rate) ? selectedCurrency : 'INR';
}

/**
 * Format an INR amount in the *selected* reference currency alone — no INR
 * shown alongside. Used by the Techno-Commercial Proposal, which renders one
 * currency per the user's toggle. A foreign currency always uses en-US
 * thousands grouping (lakh/crore grouping only makes sense for ₹); INR honours
 * the chosen digit-grouping style. Falls back to INR if the selected rate is
 * unavailable, matching resolveDisplayCurrency().
 */
export function formatInSelectedCurrency(
  inrAmount: number,
  style: 'india' | 'international',
): string {
  const display = resolveDisplayCurrency();
  const locale = display === 'INR' && style === 'india' ? 'en-IN' : 'en-US';
  const amount =
    display === 'INR'
      ? inrAmount
      : inrAmount * (cachedRates[display] as number);
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency: display,
    maximumFractionDigits: 2,
  }).format(amount);
}
