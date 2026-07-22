'use client';

import { useMemo, useState } from 'react';
import { Input } from '../../../../components/ui/input';
import { cn } from '../../../../lib/utils';

export interface PartyOption {
  id: string;
  label: string;
  sublabel?: string;
}

/**
 * Type-ahead party/ledger picker. The master lists it filters (customers,
 * vendors, ledger accounts) are all small enough to load in full and filter
 * client-side — no debounced search endpoint needed, matching how the
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
  const selected = options.find((o) => o.id === value) ?? null;

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options.slice(0, 20);
    return options
      .filter((o) => o.label.toLowerCase().includes(q) || o.sublabel?.toLowerCase().includes(q))
      .slice(0, 20);
  }, [options, query]);

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
    <div className="relative">
      <Input
        autoFocus={open}
        placeholder={placeholder ?? 'Type to search…'}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 100)}
      />
      {open && filtered.length > 0 && (
        <ul className="absolute z-10 mt-1 max-h-56 w-full overflow-auto rounded-md border bg-popover shadow-md">
          {filtered.map((o) => (
            <li key={o.id}>
              <button
                type="button"
                onClick={() => {
                  onChange(o.id);
                  setQuery('');
                  setOpen(false);
                }}
                className={cn(
                  'flex w-full flex-col items-start px-3 py-2 text-left text-sm hover:bg-accent',
                  o.id === value && 'bg-accent/50',
                )}
              >
                <span>{o.label}</span>
                {o.sublabel && <span className="text-xs text-muted-foreground">{o.sublabel}</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
