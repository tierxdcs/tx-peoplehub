import { describe, expect, it } from 'vitest';
import {
  EMPTY_BROWSE_STATE,
  buildBrowseQuery,
  buildSearchQuery,
  hasActiveFilters,
  isBrowsing,
  type VaultBrowseState,
} from './vault-query';

const FOLDER_ID = '11111111-1111-1111-1111-111111111111';

function state(overrides: Partial<VaultBrowseState> = {}): VaultBrowseState {
  return { ...EMPTY_BROWSE_STATE, ...overrides };
}

describe('buildBrowseQuery', () => {
  it('sends nothing when no filter or sort is set', () => {
    expect(buildBrowseQuery(state())).toBe('');
  });

  it('combines several filter dimensions in one request', () => {
    const query = buildBrowseQuery(
      state({
        fileType: 'PDF',
        uploadedFrom: '2026-01-01',
        uploadedTo: '2026-01-31',
        origin: 'RFQ',
        sort: 'SIZE_DESC',
      }),
    );
    const params = new URLSearchParams(query);
    expect(params.get('fileType')).toBe('PDF');
    expect(params.get('uploadedFrom')).toBe('2026-01-01');
    expect(params.get('uploadedTo')).toBe('2026-01-31');
    expect(params.get('origin')).toBe('RFQ');
    expect(params.get('sort')).toBe('SIZE_DESC');
  });

  it('omits the search term — folder listing has no q param', () => {
    expect(buildBrowseQuery(state({ term: 'quote' }))).toBe('');
  });
});

describe('buildSearchQuery', () => {
  it('trims the term and defaults to a vault-wide scope with no folder', () => {
    const params = new URLSearchParams(
      buildSearchQuery(state({ term: '  quote  ' })),
    );
    expect(params.get('q')).toBe('quote');
    expect(params.get('scope')).toBe('VAULT');
    expect(params.has('folderId')).toBe(false);
  });

  it('scopes to the folder only when asked and given one', () => {
    const scoped = new URLSearchParams(
      buildSearchQuery(state({ term: 'quote', scope: 'FOLDER' }), FOLDER_ID),
    );
    expect(scoped.get('scope')).toBe('FOLDER');
    expect(scoped.get('folderId')).toBe(FOLDER_ID);

    // Searching all of Vault from inside a folder must not pin the folder —
    // that would silently narrow the results the toggle promised to widen.
    const wide = new URLSearchParams(
      buildSearchQuery(state({ term: 'quote', scope: 'VAULT' }), FOLDER_ID),
    );
    expect(wide.get('scope')).toBe('VAULT');
    expect(wide.has('folderId')).toBe(false);
  });

  it('never sends a folder-scoped search without a folder id', () => {
    // The backend rejects that combination; fall back to vault-wide instead.
    const params = new URLSearchParams(
      buildSearchQuery(state({ term: 'quote', scope: 'FOLDER' })),
    );
    expect(params.get('scope')).toBe('VAULT');
    expect(params.has('folderId')).toBe(false);
  });

  it('carries the filters alongside the term', () => {
    const params = new URLSearchParams(
      buildSearchQuery(state({ term: 'nda', fileType: 'PDF', origin: 'DESIGN' })),
    );
    expect(params.get('q')).toBe('nda');
    expect(params.get('fileType')).toBe('PDF');
    expect(params.get('origin')).toBe('DESIGN');
  });

  it('supports a filter-only search with no term', () => {
    const params = new URLSearchParams(
      buildSearchQuery(state({ fileType: 'IMAGE' })),
    );
    expect(params.has('q')).toBe(false);
    expect(params.get('fileType')).toBe('IMAGE');
  });
});

describe('hasActiveFilters / isBrowsing', () => {
  it('treats the term and the filters as separate signals', () => {
    expect(hasActiveFilters(state())).toBe(false);
    expect(hasActiveFilters(state({ term: 'quote' }))).toBe(false);
    expect(hasActiveFilters(state({ uploadedById: 'emp-1' }))).toBe(true);
    expect(hasActiveFilters(state({ uploadedTo: '2026-01-31' }))).toBe(true);
  });

  it('is browsing when either a term or a filter narrows the view', () => {
    expect(isBrowsing(state())).toBe(false);
    expect(isBrowsing(state({ term: '   ' }))).toBe(false);
    expect(isBrowsing(state({ term: 'quote' }))).toBe(true);
    expect(isBrowsing(state({ origin: 'MANUAL' }))).toBe(true);
  });
});
