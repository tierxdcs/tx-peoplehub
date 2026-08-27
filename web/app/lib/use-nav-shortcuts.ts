'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAuth } from './auth-context';
import {
  fetchNavShortcuts,
  pinNavShortcut,
  unpinNavShortcut,
  MAX_NAV_SHORTCUTS,
  type NavShortcut,
} from './nav-shortcuts';

/**
 * The caller's pinned sidebar shortcuts.
 *
 * Toggling is optimistic — the strip updates on click and the server's returned
 * list replaces it a moment later — because a pin is a zero-risk preference and
 * a spinner on a star icon would be worse than a rare, silently-reverted click.
 * A failed toggle rolls back and surfaces the server's message (which is how the
 * "you can pin up to 8" cap is reported).
 */
export function useNavShortcuts() {
  const { user, loading: authLoading } = useAuth();
  const [shortcuts, setShortcuts] = useState<NavShortcut[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (authLoading) return;
    if (!user) {
      setShortcuts([]);
      setLoading(false);
      return;
    }
    let cancelled = false;
    fetchNavShortcuts()
      .then((rows) => {
        if (!cancelled) setShortcuts(rows);
      })
      .catch(() => {
        // A shortcuts outage must never break navigation: fall back to none.
        if (!cancelled) setShortcuts([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [authLoading, user]);

  const pinnedHrefs = useMemo(
    () => new Set(shortcuts.map((shortcut) => shortcut.href)),
    [shortcuts],
  );

  const toggle = useCallback(
    async (href: string, label: string) => {
      const wasPinned = shortcuts.some((shortcut) => shortcut.href === href);
      const previous = shortcuts;
      setError(null);
      setShortcuts(
        wasPinned
          ? shortcuts.filter((shortcut) => shortcut.href !== href)
          : [
              ...shortcuts,
              { id: `pending:${href}`, href, label, sortOrder: shortcuts.length },
            ],
      );
      try {
        const next = wasPinned
          ? await unpinNavShortcut(href)
          : await pinNavShortcut(href, label);
        setShortcuts(next);
      } catch (err) {
        setShortcuts(previous);
        setError(
          err instanceof Error ? err.message : 'Could not update shortcuts',
        );
      }
    },
    [shortcuts],
  );

  return {
    shortcuts,
    pinnedHrefs,
    toggle,
    loading,
    error,
    atCapacity: shortcuts.length >= MAX_NAV_SHORTCUTS,
  };
}
