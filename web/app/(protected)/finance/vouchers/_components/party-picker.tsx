'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Input } from '../../../../components/ui/input';
import { cn } from '../../../../lib/utils';

export interface PartyOption {
  id: string;
  label: string;
  sublabel?: string;
}

/**
 * Type-ahead party/ledger picker. The master lists it filters (customers,
 * vendors, ledger accounts, orders) are all small enough to load in full and
 * filter client-side — no debounced search endpoint needed, matching how the
 * existing AR/AP pages already fetch these lists in one call.
 */
export function PartyPicker({
  options,
  value,
  onChange,
  placeholder,
}: {
  options: PartyOption[];
  value: string;
  onChange: (id: string) => void;
  placeholder?: string;
}) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const selected = options.find((o) => o.id === value) ?? null;

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options.slice(0, 20);
    return options
      .filter(
        (o) =>
          o.label.toLowerCase().includes(q) ||
          o.sublabel?.toLowerCase().includes(q),
      )
      .slice(0, 20);
  }, [options, query]);

  /**
   * Close on a mousedown outside the field rather than on the search input's
   * blur. A blur-driven close races the option's own click: pressing an option
   * blurs the input first, so any click held longer than the teardown delay
   * unmounted the list before the click could land, and the selection was
   * silently dropped — the field looked like it simply refused to pick
   * anything. Hit-testing an outside mousedown is the same pattern ItemPicker
   * uses, and it can never fire between an option's mousedown and its click.
   */
  useEffect(() => {
    if (!open) return;
    function close(event: MouseEvent) {
      if (rootRef.current?.contains(event.target as Node)) return;
      setOpen(false);
    }
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);

  // Focus the search box when the field leaves its collapsed state: `autoFocus`
  // only applies on mount and this input stays mounted across that switch.
  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  function select(id: string) {
    // Reset before handing over, so a parent handler that throws cannot leave
    // the list stuck open on a stale query.
    setQuery('');
    setOpen(false);
    onChange(id);
  }

  if (selected && !open) {
    return (
      <button
        type="button"
        onClick={() => {
          setQuery('');
          setOpen(true);
        }}
        className="flex h-9 w-full items-center justify-between rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm hover:bg-accent"
      >
        <span className="truncate">{selected.label}</span>
        <span className="text-xs text-muted-foreground">Change</span>
      </button>
    );
  }

  return (
    <div ref={rootRef} className="relative">
      <Input
        ref={inputRef}
        placeholder={placeholder ?? 'Type to search…'}
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          // Typing reopens: after Escape the input keeps focus, so `onFocus`
          // alone would leave the list shut while the query changed under it.
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={(event) => {
          if (event.key === 'Escape') setOpen(false);
          if (event.key === 'Enter' && open && filtered.length > 0) {
            event.preventDefault();
            select(filtered[0].id);
          }
        }}
      />
      {open && (
        <ul
          role="listbox"
          className="absolute z-20 mt-1 max-h-56 w-full overflow-auto rounded-md border bg-popover shadow-md"
        >
          {filtered.length === 0 && (
            <li className="px-3 py-2 text-sm text-muted-foreground">
              No matches for “{query.trim()}”
            </li>
          )}
          {filtered.map((o) => (
            // `presentation` on the wrapper keeps the listbox owning its
            // options directly, with the <li> purely structural.
            <li key={o.id} role="presentation">
              <button
                type="button"
                role="option"
                aria-selected={o.id === value}
                // Hold focus on the search box: the focus change a plain
                // mousedown causes is what used to tear the list down mid-click.
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => select(o.id)}
                className={cn(
                  'flex w-full flex-col items-start px-3 py-2 text-left text-sm hover:bg-accent',
                  o.id === value && 'bg-accent/50',
                )}
              >
                <span>{o.label}</span>
                {o.sublabel && (
                  <span className="text-xs text-muted-foreground">
                    {o.sublabel}
                  </span>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
