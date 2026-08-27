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

// ---- sorting folders (client-side) ----

/**
 * The sorts that mean anything for a folder: a folder has no size, no file
 * type, and no relevance outside a search. Used to narrow the sort dropdown on
 * a folders-only view, so no option is offered that couldn't do anything.
 */
export const FOLDER_SORT_OPTIONS: VaultSortOption[] = [
  'NAME_ASC',
  'NAME_DESC',
  'MODIFIED_DESC',
  'MODIFIED_ASC',
];

/**
 * Apply the chosen sort to a folder list in the browser. Folders come from the
 * folder endpoints, which don't take a sort — roots arrive grouped
 * PERSONAL → DEFAULT → CUSTOM (name-ordered inside each group) and children
 * name-ordered.
 *
 * An unset sort therefore returns the list untouched, which keeps that grouping
 * and keeps a search's relevance ranking; the same is true of a file-only sort
 * (size, type) that a folder can't answer. Only an explicit, applicable choice
 * reorders — so picking a sort always visibly does what it says.
 */
export function sortFolders<T extends { name: string; updatedAt: string }>(
  folders: T[],
  sort: VaultSortOption | '',
): T[] {
  const byName = (a: T, b: T) =>
    a.name.localeCompare(b.name, undefined, {
      sensitivity: 'base',
      numeric: true,
    });
  const byModified = (a: T, b: T) =>
    new Date(a.updatedAt).getTime() - new Date(b.updatedAt).getTime();

  switch (sort) {
    case 'NAME_ASC':
      return [...folders].sort(byName);
    case 'NAME_DESC':
      return [...folders].sort((a, b) => byName(b, a));
    case 'MODIFIED_DESC':
      return [...folders].sort((a, b) => byModified(b, a));
    case 'MODIFIED_ASC':
      return [...folders].sort(byModified);
    default:
      return folders;
  }
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
