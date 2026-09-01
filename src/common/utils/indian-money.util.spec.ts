import {
  amountToIndianWords,
  formatIndianAmount,
  integerToIndianWords,
  trimDecimal,
} from './indian-money.util';

describe('integerToIndianWords', () => {
  it('groups in lakhs and crores, not thousands and millions', () => {
    // The whole reason this module exists: a Western library says "Three
    // Hundred Eighty-Nine Thousand" here, which is wrong on an Indian PO.
    expect(integerToIndianWords(389_764)).toBe(
      'Three Lakh Eighty-Nine Thousand Seven Hundred Sixty-Four',
    );
    expect(integerToIndianWords(1_00_00_000)).toBe('One Crore');
    expect(integerToIndianWords(100_00_00_000)).toBe('One Hundred Crore');
  });

  it('reads zero rather than an empty string', () => {
    expect(integerToIndianWords(0)).toBe('Zero');
  });
});

describe('amountToIndianWords', () => {
  it('names the paise only when there are some', () => {
    expect(amountToIndianWords('137000.00')).toBe(
      'Rupees One Lakh Thirty-Seven Thousand Only',
    );
    expect(amountToIndianWords('1234567.50')).toBe(
      'Rupees Twelve Lakh Thirty-Four Thousand Five Hundred Sixty-Seven and Fifty Paise Only',
    );
  });

  it('returns nothing for a value it cannot read, rather than "Rupees NaN"', () => {
    expect(amountToIndianWords('not-a-number')).toBe('');
  });
});

describe('formatIndianAmount', () => {
  it('groups the leading digits in pairs and always shows two decimals', () => {
    expect(formatIndianAmount('137000')).toBe('1,37,000.00');
    expect(formatIndianAmount('999.5')).toBe('999.50');
  });
});

describe('trimDecimal', () => {
  it('drops the padding a Decimal column adds, and keeps real precision', () => {
    expect(trimDecimal('10.0000')).toBe('10');
    expect(trimDecimal('10.5000')).toBe('10.5');
    expect(trimDecimal('212')).toBe('212');
  });
});
