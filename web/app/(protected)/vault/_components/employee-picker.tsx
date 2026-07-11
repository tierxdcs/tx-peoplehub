'use client';

import { useEffect, useRef, useState } from 'react';
import { apiFetch } from '../../../lib/api';
import type { EmployeeSearchResult } from '../../../lib/types';
import { Input } from '../../../components/ui/input';
import { Avatar } from '../../../components/ui/avatar';
import { Spinner } from '../../../components/ui/spinner';

/**
 * Type-ahead employee picker backed by GET /employees/search (all roles).
 * Debounced; shows up to a handful of matches; calls onSelect with the chosen
 * employee. Used by the internal-share dialog (spec §5.1).
 */
export function EmployeePicker({
  onSelect,
  excludeIds = [],
}: {
  onSelect: (employee: EmployeeSearchResult) => void;
  excludeIds?: string[];
}) {
  const [q, setQ] = useState('');
  const [results, setResults] = useState<EmployeeSearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    const term = q.trim();
    if (term.length < 1) {
      setResults([]);
      setOpen(false);
      return;
    }
    timer.current = setTimeout(async () => {
      setLoading(true);
      try {
        const res = await apiFetch<EmployeeSearchResult[]>(
          `/employees/search?q=${encodeURIComponent(term)}`,
        );
        setResults(res.filter((r) => !excludeIds.includes(r.id)));
        setOpen(true);
      } catch {
        setResults([]);
      } finally {
        setLoading(false);
      }
    }, 250);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
    // excludeIds is intentionally read fresh each keystroke; not a dep to avoid
    // re-running search on unrelated list changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  return (
    <div className="relative">
      <Input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Search by name or email…"
        onFocus={() => results.length > 0 && setOpen(true)}
      />
      {loading && (
        <div className="absolute right-2 top-2.5">
          <Spinner className="text-muted-foreground" />
        </div>
      )}
      {open && results.length > 0 && (
        <ul className="absolute z-50 mt-1 max-h-56 w-full overflow-y-auto rounded-md border bg-popover shadow-md">
          {results.map((r) => (
            <li key={r.id}>
              <button
                type="button"
                onClick={() => {
                  onSelect(r);
                  setQ('');
                  setResults([]);
                  setOpen(false);
                }}
                className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-accent"
              >
                <Avatar name={r.fullName} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">
                    {r.fullName}
                  </span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {r.email}
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {open && !loading && q.trim().length >= 1 && results.length === 0 && (
        <div className="absolute z-50 mt-1 w-full rounded-md border bg-popover px-3 py-2 text-sm text-muted-foreground shadow-md">
          No matches.
        </div>
      )}
    </div>
  );
}
