import { describe, expect, it } from 'vitest';
import { serverPageCount } from './server-pagination';

describe('serverPageCount', () => {
  it('returns one page for an empty result', () => {
    expect(serverPageCount(0, 25)).toBe(1);
  });

  it('does not add a page at an exact boundary', () => {
    expect(serverPageCount(25, 25)).toBe(1);
    expect(serverPageCount(50, 25)).toBe(2);
  });

  it('adds a final partial page', () => {
    expect(serverPageCount(51, 25)).toBe(3);
  });

  it('fails safely for an invalid page size', () => {
    expect(serverPageCount(100, 0)).toBe(1);
  });
});
