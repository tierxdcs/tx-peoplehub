/**
 * Convert a monetary amount to words using the INDIAN numbering system
 * (Thousand → Lakh (10^5) → Crore (10^7)), NOT the Western
 * thousand/million/billion grouping. Used for the "Amount in words" line on
 * the Techno Commercial Proposal.
 *
 * Correctness note: a Western number-to-words library would render
 * 389764 as "Three Hundred Eighty-Nine Thousand …" — WRONG here. The Indian
 * system groups the leading digits in pairs (lakh/crore), giving
 * "Three Lakh Eighty-Nine Thousand Seven Hundred Sixty-Four". This module is
 * unit-tested against exactly that class of value.
 */

const ONES = [
  'Zero', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight',
  'Nine', 'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen',
  'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen',
];
const TENS = [
  '', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty',
  'Ninety',
];

/** Words for a number 0–999 (no scale word). Returns '' for 0. */
function belowThousand(n: number): string {
  if (n === 0) return '';
  const parts: string[] = [];
  const hundreds = Math.floor(n / 100);
  const rest = n % 100;
  if (hundreds > 0) parts.push(`${ONES[hundreds]} Hundred`);
  if (rest > 0) {
    if (rest < 20) parts.push(ONES[rest]);
    else {
      const t = Math.floor(rest / 10);
      const o = rest % 10;
      parts.push(o > 0 ? `${TENS[t]}-${ONES[o]}` : TENS[t]);
    }
  }
  return parts.join(' ');
}

/**
 * Whole-number → Indian-system words. 0 → "Zero". Handles arbitrary
 * magnitudes by prepending crore groups (…, Thousand Crore, Lakh Crore, Crore).
 */
export function integerToIndianWords(value: number): string {
  const n = Math.floor(Math.abs(value));
  if (n === 0) return 'Zero';

  const parts: string[] = [];

  // Everything from one crore (10^7) up is itself counted in crores, and that
  // crore-count follows Indian grouping too — so express it recursively:
  // 100_00_00_000 → 100 crore → "One Hundred Crore".
  const crore = Math.floor(n / 10_000_000);
  const belowCrore = n % 10_000_000;
  if (crore > 0) parts.push(`${integerToIndianWords(crore)} Crore`);

  const lakh = Math.floor(belowCrore / 100_000);
  if (lakh > 0) parts.push(`${belowThousand(lakh)} Lakh`);

  const thousand = Math.floor((belowCrore % 100_000) / 1000);
  if (thousand > 0) parts.push(`${belowThousand(thousand)} Thousand`);

  const last3 = belowCrore % 1000;
  if (last3 > 0) parts.push(belowThousand(last3));

  return parts.join(' ').trim();
}

/**
 * Full rupees-and-paise amount in words, Indian system, e.g.
 *   389764      → "Rupees Three Lakh Eighty-Nine Thousand Seven Hundred Sixty-Four Only"
 *   1234567.50  → "Rupees Twelve Lakh Thirty-Four Thousand Five Hundred Sixty-Seven and Fifty Paise Only"
 * Paise are rounded to 2 dp. Accepts a number or a decimal string (as the Bid
 * totals arrive from the API).
 */
export function amountToIndianWords(value: string | number): string {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return '';

  const rounded = Math.round(Math.abs(n) * 100); // work in paise, avoids fp drift
  const rupees = Math.floor(rounded / 100);
  const paise = rounded % 100;

  const rupeeWords = `Rupees ${integerToIndianWords(rupees)}`;
  const paiseWords =
    paise > 0 ? ` and ${integerToIndianWords(paise)} Paise` : '';
  return `${rupeeWords}${paiseWords} Only`;
}
