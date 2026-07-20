import { describe, expect, it } from 'vitest';
import { QUOTES, quoteOfTheDay } from './quotes';

describe('quoteOfTheDay', () => {
  it('returns the same quote for every call on the same calendar day', () => {
    const morning = new Date(Date.UTC(2026, 6, 13, 1, 0, 0));
    const evening = new Date(Date.UTC(2026, 6, 13, 23, 0, 0));
    expect(quoteOfTheDay(morning)).toEqual(quoteOfTheDay(evening));
  });

  it('changes at the UTC day boundary', () => {
    const day1 = new Date(Date.UTC(2026, 6, 13, 12, 0, 0));
    const day2 = new Date(Date.UTC(2026, 6, 14, 12, 0, 0));
    // Adjacent days pick adjacent list entries — guaranteed different given >1 quote.
    expect(quoteOfTheDay(day1)).not.toEqual(quoteOfTheDay(day2));
  });

  it('is deterministic (not random) — repeated calls agree', () => {
    const d = new Date(Date.UTC(2026, 0, 1, 8, 30, 0));
    expect(quoteOfTheDay(d)).toEqual(quoteOfTheDay(d));
  });

  it('every quote has non-empty text and author', () => {
    for (const q of QUOTES) {
      expect(q.text.length).toBeGreaterThan(0);
      expect(q.author.length).toBeGreaterThan(0);
    }
  });
});
