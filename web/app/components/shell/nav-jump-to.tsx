'use client';

import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Search, X } from 'lucide-react';
import type { NavLeaf } from '../../lib/nav';
import { searchNav } from '../../lib/nav-search';
import { cn } from '../../lib/utils';
import { iconForHref } from './nav-icons';

/**
 * "Jump to" — the fastest path to any page, and the reason collapsing sections
 * by default costs nothing: a page one click away in a collapsed section is
 * still one keystroke away here.
 *
 * Searches the flat list of leaf pages across every module the user can see, so
 * the result doesn't depend on which section (or module) the page lives under.
 * Fuzzy-matched client-side — see nav-search.ts for the scoring ladder.
 */
export function NavJumpTo({
  leaves,
  onNavigate,
}: {
  leaves: NavLeaf[];
  /** Called after a result is chosen — lets the mobile drawer close itself. */
  onNavigate?: () => void;
}) {
  const router = useRouter();
  const listId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState('');
  const [highlight, setHighlight] = useState(0);

  const hits = useMemo(() => searchNav(query, leaves), [query, leaves]);

  // Any change to the query invalidates the previous cursor position.
  useEffect(() => setHighlight(0), [query]);

  function choose(href: string) {
    setQuery('');
    onNavigate?.();
    router.push(href);
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Escape') {
      setQuery('');
      inputRef.current?.blur();
      return;
    }
    if (!hits.length) return;
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setHighlight((current) => (current + 1) % hits.length);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setHighlight((current) => (current - 1 + hits.length) % hits.length);
    } else if (event.key === 'Enter') {
      event.preventDefault();
      choose(hits[Math.min(highlight, hits.length - 1)].leaf.href);
    }
  }

  const open = query.trim().length > 0;

  return (
    <div>
      <div className="relative">
        <Search
          aria-hidden="true"
          className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
        />
        <input
          ref={inputRef}
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={onKeyDown}
          placeholder="Jump to…"
          aria-label="Jump to a page"
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={
            open && hits.length ? `${listId}-${highlight}` : undefined
          }
          className={cn(
            'h-10 w-full rounded-md border bg-background pl-8 pr-8 text-sm',
            'placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring',
            '[&::-webkit-search-cancel-button]:hidden',
          )}
        />
        {open && (
          <button
            type="button"
            onClick={() => {
              setQuery('');
              inputRef.current?.focus();
            }}
            aria-label="Clear search"
            className="absolute right-1.5 top-1/2 flex size-7 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            <X className="size-3.5" />
          </button>
        )}
      </div>

      {open && (
        <div className="mt-2 rounded-md border bg-background p-1">
          {hits.length === 0 ? (
            <p className="px-2 py-1.5 text-xs text-muted-foreground">
              No page matches “{query.trim()}”.
            </p>
          ) : (
            <ul id={listId} role="listbox" aria-label="Search results">
              {hits.map((hit, index) => {
                const ItemIcon = iconForHref(hit.leaf.href);
                return (
                  <li key={hit.leaf.href}>
                    <button
                      type="button"
                      id={`${listId}-${index}`}
                      role="option"
                      aria-selected={index === highlight}
                      onMouseEnter={() => setHighlight(index)}
                      onClick={() => choose(hit.leaf.href)}
                      className={cn(
                        'flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm',
                        index === highlight
                          ? 'bg-accent text-accent-foreground'
                          : 'text-foreground/80',
                      )}
                    >
                      <ItemIcon
                        aria-hidden="true"
                        className="size-4 shrink-0 opacity-75"
                      />
                      <span className="min-w-0 flex-1 truncate">
                        {hit.leaf.label}
                      </span>
                      <span className="shrink-0 text-[10px] uppercase tracking-wider text-muted-foreground">
                        {hit.leaf.section}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
