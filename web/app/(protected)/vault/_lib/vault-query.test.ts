import { describe, expect, it } from 'vitest';
import {
  EMPTY_BROWSE_STATE,
  FOLDER_SORT_OPTIONS,
  buildBrowseQuery,
  buildSearchQuery,
  hasActiveFilters,
  isBrowsing,
  sortFolders,
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

/** Minimal shape sortFolders needs — the real VaultFolder carries much more. */
const folder = (name: string, updatedAt: string) => ({ name, updatedAt });

const roots = [
  folder('My Documents', '2026-08-20T10:00:00.000Z'),
  folder('Compliance & Legal', '2026-08-26T10:00:00.000Z'),
  folder('audit trail', '2026-01-05T10:00:00.000Z'),
];
const names = (list: { name: string }[]) => list.map((f) => f.name);

describe('sortFolders', () => {
  it('leaves the list untouched when no sort is chosen', () => {
    // Roots arrive grouped PERSONAL → DEFAULT → CUSTOM from the backend, and a
    // search returns folders in relevance order: neither may be reshuffled.
    expect(sortFolders(roots, '')).toBe(roots);
  });

  it('sorts by name in both directions, case-insensitively', () => {
    expect(names(sortFolders(roots, 'NAME_ASC'))).toEqual([
      'audit trail',
      'Compliance & Legal',
      'My Documents',
    ]);
    expect(names(sortFolders(roots, 'NAME_DESC'))).toEqual([
      'My Documents',
      'Compliance & Legal',
      'audit trail',
    ]);
  });

  it('sorts by last modified in both directions', () => {
    expect(names(sortFolders(roots, 'MODIFIED_DESC'))).toEqual([
      'Compliance & Legal',
      'My Documents',
      'audit trail',
    ]);
    expect(names(sortFolders(roots, 'MODIFIED_ASC'))).toEqual([
      'audit trail',
      'My Documents',
      'Compliance & Legal',
    ]);
  });

  it('leaves the order alone for a sort a folder cannot answer', () => {
    // A folder has no size and no file type, so these are no-ops rather than a
    // silent name sort that would look like the wrong sort was applied.
    for (const sort of ['SIZE_DESC', 'SIZE_ASC', 'TYPE_ASC', 'RELEVANCE'] as const) {
      expect(sortFolders(roots, sort)).toBe(roots);
    }
  });

  it('never reorders the caller’s array in place', () => {
    const original = [...roots];
    sortFolders(roots, 'NAME_ASC');
    expect(roots).toEqual(original);
  });

  it('offers exactly the sorts sortFolders can apply', () => {
    // The dropdown is narrowed with this list, so it must stay in step with the
    // switch above — an offered option that does nothing is the bug it prevents.
    expect(FOLDER_SORT_OPTIONS).toEqual([
      'NAME_ASC',
      'NAME_DESC',
      'MODIFIED_DESC',
      'MODIFIED_ASC',
    ]);
    for (const sort of FOLDER_SORT_OPTIONS) {
      expect(sortFolders(roots, sort)).not.toBe(roots);
    }
  });
});
