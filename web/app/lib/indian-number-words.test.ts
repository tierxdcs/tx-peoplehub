import { describe, it, expect } from 'vitest';
import {
  integerToIndianWords,
  amountToIndianWords,
} from './indian-number-words';

describe('integerToIndianWords (Indian grouping)', () => {
  it('handles zero and small numbers', () => {
    expect(integerToIndianWords(0)).toBe('Zero');
    expect(integerToIndianWords(7)).toBe('Seven');
    expect(integerToIndianWords(19)).toBe('Nineteen');
    expect(integerToIndianWords(20)).toBe('Twenty');
    expect(integerToIndianWords(64)).toBe('Sixty-Four');
    expect(integerToIndianWords(100)).toBe('One Hundred');
    expect(integerToIndianWords(764)).toBe('Seven Hundred Sixty-Four');
  });

  it('groups thousands (Indian, not Western)', () => {
    expect(integerToIndianWords(1000)).toBe('One Thousand');
    expect(integerToIndianWords(12764)).toBe(
      'Twelve Thousand Seven Hundred Sixty-Four',
    );
  });

  // The reference-PDF value — the exact case a Western library gets wrong.
  it('uses Lakh, not "hundred thousand", for the reference total', () => {
    expect(integerToIndianWords(389764)).toBe(
      'Three Lakh Eighty-Nine Thousand Seven Hundred Sixty-Four',
    );
  });

  it('handles lakhs and crores with the 2-digit grouping', () => {
    expect(integerToIndianWords(100000)).toBe('One Lakh');
    expect(integerToIndianWords(1234567)).toBe(
      'Twelve Lakh Thirty-Four Thousand Five Hundred Sixty-Seven',
    );
    expect(integerToIndianWords(10000000)).toBe('One Crore');
    // 1,00,00,00,000 = one hundred crore (crore overflow keeps grouping).
    expect(integerToIndianWords(1000000000)).toBe('One Hundred Crore');
  });
});

describe('amountToIndianWords (rupees + paise)', () => {
  it('formats the reference grand total', () => {
    expect(amountToIndianWords(389764)).toBe(
      'Rupees Three Lakh Eighty-Nine Thousand Seven Hundred Sixty-Four Only',
    );
    // Same value as a decimal string, as the API serializes Bid totals.
    expect(amountToIndianWords('389764.00')).toBe(
      'Rupees Three Lakh Eighty-Nine Thousand Seven Hundred Sixty-Four Only',
    );
  });

  it('includes paise when present, rounded to 2dp', () => {
    expect(amountToIndianWords('1234567.50')).toBe(
      'Rupees Twelve Lakh Thirty-Four Thousand Five Hundred Sixty-Seven and Fifty Paise Only',
    );
    expect(amountToIndianWords(99.99)).toBe(
      'Rupees Ninety-Nine and Ninety-Nine Paise Only',
    );
  });

  it('handles zero', () => {
    expect(amountToIndianWords(0)).toBe('Rupees Zero Only');
  });
});
