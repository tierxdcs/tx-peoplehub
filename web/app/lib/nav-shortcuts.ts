import { apiFetch } from './api';

/**
 * Per-employee pinned sidebar shortcuts. Backend-persisted (unlike the sidebar's
 * expand/collapse state, which is local per-device) so a user's shortcuts follow
 * them to any browser or machine.
 *
 * Every mutation returns the whole ordered list, so callers replace their state
 * rather than patching it.
 */

export interface NavShortcut {
  id: string;
  href: string;
  label: string;
  sortOrder: number;
}

/** Server-enforced cap; mirrored here so the UI can explain itself first. */
export const MAX_NAV_SHORTCUTS = 8;

export function fetchNavShortcuts() {
  return apiFetch<NavShortcut[]>('/nav-shortcuts');
}

export function pinNavShortcut(href: string, label: string) {
  return apiFetch<NavShortcut[]>('/nav-shortcuts', {
    method: 'POST',
    body: JSON.stringify({ href, label }),
  });
}

export function unpinNavShortcut(href: string) {
  return apiFetch<NavShortcut[]>(
    `/nav-shortcuts?href=${encodeURIComponent(href)}`,
    { method: 'DELETE' },
  );
}
