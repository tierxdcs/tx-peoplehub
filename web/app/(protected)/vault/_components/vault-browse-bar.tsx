'use client';

import { useEffect, useState } from 'react';
import { LayoutGrid, List, Search, SlidersHorizontal, X } from 'lucide-react';
import type {
  VaultFileOrigin,
  VaultFileTypeCategory,
  VaultSortOption,
} from '../../../lib/types';
import { Badge } from '../../../components/ui/badge';
import { Button } from '../../../components/ui/button';
import { Input } from '../../../components/ui/input';
import { Label } from '../../../components/ui/label';
import { Select } from '../../../components/ui/select';
import { SCard } from '../../../components/ui/signal';
import { EmployeePicker } from './employee-picker';
import {
  FILE_TYPE_OPTIONS,
  ORIGIN_OPTIONS,
  SORT_OPTIONS,
  fileTypeLabel,
  originLabel,
} from '../_lib/vault-format';
import {
  EMPTY_BROWSE_STATE,
  FOLDER_SORT_OPTIONS,
  hasActiveFilters,
  isBrowsing,
  type VaultBrowseState,
  type VaultViewMode,
} from '../_lib/vault-query';

/**
 * Vault's browse controls: fuzzy search with an explicit scope, the four filter
 * dimensions, sort, and the grid/list toggle. Purely controlled — the page owns
 * the state and does the fetching, so the same bar drives the folder view and
 * the vault-wide view without either growing its own copy of the rules.
 *
 * Filters are collapsed behind a toggle (with a live count) so the default
 * folder view stays a clean browsing surface rather than a filter console.
 */
export function VaultBrowseBar({
  state,
  onChange,
  scopeFolderName,
  sortTarget = 'files',
  view,
  onViewChange,
  searchPlaceholder = 'Search files and folders…',
  summary,
}: {
  state: VaultBrowseState;
  onChange: (patch: Partial<VaultBrowseState>) => void;
  /**
   * Name of the folder being browsed. Present = the scope toggle is offered;
   * absent = the view is inherently vault-wide (the Vault landing page).
   */
  scopeFolderName?: string;
  /**
   * What the list below currently holds. 'folders' (the Vault landing page with
   * no search running) narrows the sort dropdown to the sorts a folder can
   * answer, rather than offering size/type options that would do nothing.
   */
  sortTarget?: 'files' | 'folders';
  view: VaultViewMode;
  onViewChange: (view: VaultViewMode) => void;
  searchPlaceholder?: string;
  summary?: React.ReactNode;
}) {
  const [showFilters, setShowFilters] = useState(() => hasActiveFilters(state));
  const [uploaderName, setUploaderName] = useState('');

  // The picker keeps the chosen name only for display; the id is the state that
  // matters. Clearing the filter from anywhere must clear the label too.
  useEffect(() => {
    if (!state.uploadedById) setUploaderName('');
  }, [state.uploadedById]);

  const searching = Boolean(state.term.trim());
  const activeFilterCount = [
    state.fileType,
    state.uploadedById,
    state.uploadedFrom,
    state.uploadedTo,
    state.origin,
  ].filter(Boolean).length;
  // Relevance only ranks when there's something to be relevant to, and a
  // folders-only list can't be sorted by size or file type.
  const sortOptions = SORT_OPTIONS.filter(
    (option) =>
      (option.value !== 'RELEVANCE' || searching) &&
      (sortTarget === 'files' || FOLDER_SORT_OPTIONS.includes(option.value)),
  );
  const chosenSort: VaultSortOption =
    state.sort || (searching ? 'RELEVANCE' : 'NAME_ASC');
  // Never show a value the dropdown no longer offers (clearing a search drops
  // RELEVANCE; a folders-only list drops the file-only sorts) — a native select
  // with no matching option renders blank.
  const effectiveSort = sortOptions.some((o) => o.value === chosenSort)
    ? chosenSort
    : (sortOptions[0]?.value ?? 'NAME_ASC');

  function clearFilters() {
    onChange({
      fileType: '',
      uploadedById: '',
      uploadedFrom: '',
      uploadedTo: '',
      origin: '',
    });
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-0 flex-1 sm:max-w-sm">
          <Search
            className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden
          />
          <Input
            value={state.term}
            onChange={(event) => onChange({ term: event.target.value })}
            placeholder={searchPlaceholder}
            aria-label={searchPlaceholder}
            className="pl-8 pr-8"
          />
          {state.term && (
            <button
              type="button"
              aria-label="Clear search"
              onClick={() => onChange({ term: '' })}
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-0.5 text-muted-foreground hover:text-foreground"
            >
              <X className="size-4" />
            </button>
          )}
        </div>

        {scopeFolderName && (
          <div
            role="group"
            aria-label="Search scope"
            className="inline-flex rounded-md border p-0.5"
          >
            <button
              type="button"
              aria-pressed={state.scope === 'FOLDER'}
              onClick={() => onChange({ scope: 'FOLDER' })}
              className={`rounded px-2.5 py-1 text-xs font-medium transition-colors ${
                state.scope === 'FOLDER'
                  ? 'bg-secondary text-secondary-foreground'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              This folder
            </button>
            <button
              type="button"
              aria-pressed={state.scope === 'VAULT'}
              onClick={() => onChange({ scope: 'VAULT' })}
              className={`rounded px-2.5 py-1 text-xs font-medium transition-colors ${
                state.scope === 'VAULT'
                  ? 'bg-secondary text-secondary-foreground'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              Entire Vault
            </button>
          </div>
        )}

        <Button
          variant="outline"
          size="sm"
          onClick={() => setShowFilters((open) => !open)}
          aria-expanded={showFilters}
        >
          <SlidersHorizontal /> Filters
          {activeFilterCount > 0 && (
            <Badge variant="secondary">{activeFilterCount}</Badge>
          )}
        </Button>

        <Select
          value={effectiveSort}
          onChange={(event) =>
            onChange({ sort: event.target.value as VaultSortOption })
          }
          aria-label="Sort by"
          className="h-9 w-auto md:h-8 md:text-xs"
        >
          {sortOptions.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </Select>

        <div
          role="group"
          aria-label="View mode"
          className="ml-auto inline-flex rounded-md border p-0.5"
        >
          <button
            type="button"
            aria-label="Grid view"
            aria-pressed={view === 'grid'}
            onClick={() => onViewChange('grid')}
            className={`rounded p-1.5 transition-colors ${
              view === 'grid'
                ? 'bg-secondary text-secondary-foreground'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            <LayoutGrid className="size-4" />
          </button>
          <button
            type="button"
            aria-label="List view"
            aria-pressed={view === 'list'}
            onClick={() => onViewChange('list')}
            className={`rounded p-1.5 transition-colors ${
              view === 'list'
                ? 'bg-secondary text-secondary-foreground'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            <List className="size-4" />
          </button>
        </div>
      </div>

      {/* Say plainly what is being searched — an ambiguous scope is the usual
          source of "I know the file is in here somewhere" confusion. */}
      {isBrowsing(state) && (
        <p className="text-xs text-muted-foreground">
          {scopeFolderName && state.scope === 'FOLDER'
            ? `Showing matches in “${scopeFolderName}” and everything inside it.`
            : 'Showing matches from every folder you can access.'}
        </p>
      )}

      {showFilters && (
        <SCard className="grid gap-3 p-3 sm:grid-cols-2 lg:grid-cols-4">
          <div className="space-y-1.5">
            <Label htmlFor="vault-filter-type">File type</Label>
            <Select
              id="vault-filter-type"
              value={state.fileType}
              onChange={(event) =>
                onChange({
                  fileType: event.target.value as VaultFileTypeCategory | '',
                })
              }
            >
              <option value="">Any type</option>
              {FILE_TYPE_OPTIONS.map((type) => (
                <option key={type} value={type}>
                  {fileTypeLabel(type)}
                </option>
              ))}
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="vault-filter-origin">Source</Label>
            <Select
              id="vault-filter-origin"
              value={state.origin}
              onChange={(event) =>
                onChange({ origin: event.target.value as VaultFileOrigin | '' })
              }
            >
              <option value="">Any source</option>
              {ORIGIN_OPTIONS.map((origin) => (
                <option key={origin} value={origin}>
                  {originLabel(origin)}
                </option>
              ))}
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label>Uploaded</Label>
            <div className="flex items-center gap-1">
              <Input
                type="date"
                value={state.uploadedFrom}
                max={state.uploadedTo || undefined}
                onChange={(event) =>
                  onChange({ uploadedFrom: event.target.value })
                }
                aria-label="Uploaded from"
              />
              <span className="text-xs text-muted-foreground">to</span>
              <Input
                type="date"
                value={state.uploadedTo}
                min={state.uploadedFrom || undefined}
                onChange={(event) =>
                  onChange({ uploadedTo: event.target.value })
                }
                aria-label="Uploaded to"
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>Uploaded by</Label>
            {state.uploadedById ? (
              <div className="flex h-11 items-center gap-2 rounded-md border bg-background px-3 md:h-9">
                <span className="min-w-0 flex-1 truncate text-sm">
                  {uploaderName || 'Selected employee'}
                </span>
                <button
                  type="button"
                  aria-label="Clear uploaded by filter"
                  onClick={() => onChange({ uploadedById: '' })}
                  className="text-muted-foreground hover:text-foreground"
                >
                  <X className="size-4" />
                </button>
              </div>
            ) : (
              <EmployeePicker
                onSelect={(employee) => {
                  setUploaderName(employee.fullName);
                  onChange({ uploadedById: employee.id });
                }}
              />
            )}
          </div>

          <div className="flex items-center gap-3 sm:col-span-2 lg:col-span-4">
            {activeFilterCount > 0 && (
              <Button variant="ghost" size="sm" onClick={clearFilters}>
                Clear filters
              </Button>
            )}
            {(activeFilterCount > 0 || searching) && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() =>
                  onChange({ ...EMPTY_BROWSE_STATE, scope: state.scope })
                }
              >
                Reset all
              </Button>
            )}
            {summary && (
              <span className="ml-auto text-xs text-muted-foreground">
                {summary}
              </span>
            )}
          </div>
        </SCard>
      )}

      {!showFilters && summary && (
        <p className="text-xs text-muted-foreground">{summary}</p>
      )}
    </div>
  );
}
