import type {
  VaultFileOrigin,
  VaultFileTypeCategory,
  VaultSearchScope,
  VaultSortOption,
} from '../../../lib/types';

/**
 * The browse state the Vault UI owns: a search term, its scope, the four filter
 * dimensions, and a sort. Kept as one object so a page passes a single value to
 * the controls and turns that same value into a request — the request can never
 * drift from what the controls show.
 */
export interface VaultBrowseState {
  term: string;
  scope: VaultSearchScope;
  fileType: VaultFileTypeCategory | '';
  uploadedById: string;
  /** yyyy-mm-dd from a date input; the backend widens it to end-of-day. */
  uploadedFrom: string;
  uploadedTo: string;
  origin: VaultFileOrigin | '';
  sort: VaultSortOption | '';
}

export const EMPTY_BROWSE_STATE: VaultBrowseState = {
  term: '',
  scope: 'FOLDER',
  fileType: '',
  uploadedById: '',
  uploadedFrom: '',
  uploadedTo: '',
  origin: '',
  sort: '',
};

/** Is any filter (not the search term) narrowing the list right now? */
export function hasActiveFilters(state: VaultBrowseState): boolean {
  return Boolean(
    state.fileType ||
      state.uploadedById ||
      state.uploadedFrom ||
      state.uploadedTo ||
      state.origin,
  );
}

/** Is the browse state doing anything at all beyond a plain folder listing? */
export function isBrowsing(state: VaultBrowseState): boolean {
  return Boolean(state.term.trim()) || hasActiveFilters(state);
}

/**
 * Browse state → query string for /vault/folders/:id/files (filters + sort
 * only). Empty values are omitted rather than sent blank, so "no filter" is
 * never mistaken for "filter on empty string" by the validation pipe.
 */
export function buildBrowseQuery(state: VaultBrowseState): string {
  const params = new URLSearchParams();
  if (state.fileType) params.set('fileType', state.fileType);
  if (state.uploadedById) params.set('uploadedById', state.uploadedById);
  if (state.uploadedFrom) params.set('uploadedFrom', state.uploadedFrom);
  if (state.uploadedTo) params.set('uploadedTo', state.uploadedTo);
  if (state.origin) params.set('origin', state.origin);
  if (state.sort) params.set('sort', state.sort);
  return params.toString();
}

/**
 * Browse state → query string for /vault/files/search. `folderId` is only sent
 * with scope=FOLDER (the backend rejects a folder-scoped search without one),
 * and the term is trimmed so trailing spaces don't change the ranking.
 */
export function buildSearchQuery(
  state: VaultBrowseState,
  folderId?: string,
): string {
  const params = new URLSearchParams(buildBrowseQuery(state));
  const term = state.term.trim();
  if (term) params.set('q', term);
  const scope = folderId ? state.scope : 'VAULT';
  params.set('scope', scope);
  if (scope === 'FOLDER' && folderId) params.set('folderId', folderId);
  return params.toString();
}

// ---- view mode ----

export type VaultViewMode = 'grid' | 'list';

const VIEW_MODE_KEY = 'vault:viewMode';

/**
 * Grid is the default: Vault is a browsing experience, not a register table.
 * List is opt-in and remembered, so someone comparing sizes/dates doesn't have
 * to re-pick it on every folder.
 */
export function loadViewMode(): VaultViewMode {
  if (typeof window === 'undefined') return 'grid';
  return window.localStorage.getItem(VIEW_MODE_KEY) === 'list'
    ? 'list'
    : 'grid';
}

export function saveViewMode(mode: VaultViewMode): void {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(VIEW_MODE_KEY, mode);
}
