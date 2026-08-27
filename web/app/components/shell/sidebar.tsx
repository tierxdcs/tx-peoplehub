'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ChevronDown, Pin, PinOff, X } from 'lucide-react';
import type { NavGroup, NavLeaf } from '../../lib/nav';
import { MAX_NAV_SHORTCUTS } from '../../lib/nav-shortcuts';
import { useNavShortcuts } from '../../lib/use-nav-shortcuts';
import { cn } from '../../lib/utils';
import { Badge } from '../ui/badge';
import { iconForHref } from './nav-icons';
import { NavJumpTo } from './nav-jump-to';

/**
 * Headings the user has opened, persisted per-device.
 *
 * Deliberately a NEW key rather than the old `sidebar:collapsedGroups`: that key
 * stored the *collapsed* headings (default = expanded), and the default is now
 * inverted. Reusing it would make every previously-collapsed section read as the
 * only expanded one.
 */
const EXPAND_KEY = 'sidebar:expandedSections';

/**
 * Per-module left nav. Renders only the groups/items passed in (already gated by
 * the nav model), highlighting the active route. Longest-prefix match so e.g.
 * /sales/bids/new keeps "Bids" active.
 *
 * Three things keep 20+ sections manageable:
 *  - Sections are accordions, **collapsed by default**. The section holding the
 *    current page is always expanded, so the active row is never hidden. Toggling
 *    is independent — opening one section leaves the others alone, since
 *    cross-referencing two areas is normal. Open headings persist in
 *    localStorage (a per-device convenience, not worth a backend round-trip).
 *  - "Jump to" search over every leaf page in every module the user can reach —
 *    collapsing costs nothing when any page is a few keystrokes away.
 *  - Pinned shortcuts, stored per-employee on the server so they follow the user
 *    across devices.
 *
 * `badges` maps a nav item's href to a pending count; items with a count > 0
 * render a small numeric pill at the right of the row (hidden when 0/absent).
 */
export function Sidebar({
  groups,
  searchLeaves = [],
  badges,
  mobileOpen = false,
  onMobileClose,
}: {
  groups: NavGroup[];
  /** Flat leaf pages across all of the user's modules — the search index. */
  searchLeaves?: NavLeaf[];
  badges?: Record<string, number>;
  mobileOpen?: boolean;
  onMobileClose?: () => void;
}) {
  const pathname = usePathname();
  const {
    shortcuts,
    pinnedHrefs,
    toggle: togglePin,
    error: shortcutError,
    atCapacity,
  } = useNavShortcuts();

  // Set of expanded group headings. Hydrated from localStorage after mount
  // (kept empty on first render so server and client markup match — the active
  // section is expanded either way, so the pre-hydration paint is usable).
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  useEffect(() => {
    try {
      const raw = localStorage.getItem(EXPAND_KEY);
      if (raw) setExpanded(new Set(JSON.parse(raw) as string[]));
    } catch {
      /* ignore malformed / unavailable storage */
    }
  }, []);

  function toggleSection(heading: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(heading)) next.delete(heading);
      else next.add(heading);
      try {
        localStorage.setItem(EXPAND_KEY, JSON.stringify([...next]));
      } catch {
        /* ignore */
      }
      return next;
    });
  }

  const activeHref = groups
    .flatMap((g) => g.items)
    .map((i) => i.href)
    .filter((href) => pathname === href || pathname.startsWith(href + '/'))
    .sort((a, b) => b.length - a.length)[0];

  const allItems = groups.flatMap((group) => group.items);
  const quickItems = allItems.filter(
    (item, index, items) =>
      (item.href === '/dashboard' ||
        item.href === '/kanban' ||
        item.href.includes('pending-approval') ||
        item.href.includes('leave-approvals')) &&
      items.findIndex((candidate) => candidate.href === item.href) === index,
  );

  // Live labels win over the snapshot stored with the pin, so a renamed page
  // shows its current name; the snapshot covers pins made in another module.
  const liveLabels = useMemo(
    () => new Map(searchLeaves.map((leaf) => [leaf.href, leaf.label])),
    [searchLeaves],
  );

  return (
    <>
      {mobileOpen && (
        <button
          type="button"
          aria-label="Close navigation"
          onClick={onMobileClose}
          className="fixed inset-0 top-14 z-40 bg-black/40 md:hidden"
        />
      )}
      {/*
        The sidebar owns its own scroll: on desktop it is a sticky, viewport-tall
        box (`md:h-[calc(100dvh-3.5rem)]` under the 3.5rem header) that does not
        stretch (`md:self-start`). Without that, the aside's intrinsic content
        height set the flex row's height and left dead space below shorter pages.
      */}
      <aside
        className={cn(
          'fixed bottom-0 left-0 top-14 z-50 w-[min(20rem,86vw)] shrink-0 overflow-y-auto border-r bg-card transition-transform',
          'md:sticky md:top-14 md:z-auto md:h-[calc(100dvh-3.5rem)] md:w-60 md:translate-x-0 md:self-start',
          mobileOpen ? 'translate-x-0' : '-translate-x-full',
        )}
      >
        <div className="sticky top-0 z-10 flex items-center justify-between border-b bg-card px-4 py-2 md:hidden">
          <span className="text-sm font-semibold">Navigation</span>
          <button
            type="button"
            onClick={onMobileClose}
            className="flex size-11 items-center justify-center rounded-md hover:bg-accent"
            aria-label="Close navigation"
          >
            <X className="size-5" />
          </button>
        </div>
        <nav className="flex flex-col gap-4 p-4">
          <NavJumpTo leaves={searchLeaves} onNavigate={onMobileClose} />

          {shortcutError && (
            <p className="px-2 text-xs text-destructive">{shortcutError}</p>
          )}

          {shortcuts.length > 0 && (
            <div>
              <p className="mb-1 px-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Pinned
              </p>
              <ul className="flex flex-col gap-0.5">
                {shortcuts.map((shortcut) => (
                  <NavRow
                    key={`pinned-${shortcut.href}`}
                    href={shortcut.href}
                    label={liveLabels.get(shortcut.href) ?? shortcut.label}
                    active={shortcut.href === activeHref}
                    count={badges?.[shortcut.href]}
                    pinned
                    onTogglePin={() =>
                      void togglePin(
                        shortcut.href,
                        liveLabels.get(shortcut.href) ?? shortcut.label,
                      )
                    }
                  />
                ))}
              </ul>
              <div className="mt-3 border-t" />
            </div>
          )}

          {quickItems.length > 0 && (
            <div className="md:hidden">
              <p className="mb-2 px-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Quick access
              </p>
              <ul className="space-y-1">
                {quickItems.map((item) => {
                  const ItemIcon = iconForHref(item.href);
                  return (
                    <li key={`quick-${item.href}`}>
                      <Link
                        href={item.href}
                        className="flex min-h-11 items-center gap-3 rounded-md px-3 text-sm font-medium hover:bg-accent"
                      >
                        <ItemIcon className="size-5 text-primary" />
                        {item.label}
                      </Link>
                    </li>
                  );
                })}
              </ul>
              <div className="mt-4 border-t" />
            </div>
          )}

          {groups.map((group) => {
            // The section holding the current page is always open, whatever the
            // stored state says — the active row must never be hidden.
            const hasActive = group.items.some((i) => i.href === activeHref);
            const isOpen = hasActive || expanded.has(group.heading);
            return (
              <div key={group.heading}>
                <button
                  type="button"
                  onClick={() => toggleSection(group.heading)}
                  aria-expanded={isOpen}
                  className="mb-1 flex w-full items-center justify-between gap-2 rounded-md px-2 py-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground transition-colors hover:text-foreground"
                >
                  <span>{group.heading}</span>
                  <ChevronDown
                    className={cn(
                      'h-3.5 w-3.5 shrink-0 transition-transform',
                      !isOpen && '-rotate-90',
                    )}
                  />
                </button>
                {isOpen && (
                  <ul className="flex flex-col gap-0.5">
                    {group.items.map((item) => {
                      const pinned = pinnedHrefs.has(item.href);
                      return (
                        <NavRow
                          key={item.href}
                          href={item.href}
                          label={item.label}
                          active={item.href === activeHref}
                          count={badges?.[item.href]}
                          pinned={pinned}
                          pinDisabled={!pinned && atCapacity}
                          onTogglePin={() =>
                            void togglePin(item.href, item.label)
                          }
                        />
                      );
                    })}
                  </ul>
                )}
              </div>
            );
          })}
        </nav>
      </aside>
    </>
  );
}

/**
 * One leaf row: the link, its pending-count pill, and the pin toggle.
 *
 * The pin sits outside the <Link> (nesting a button inside an anchor is invalid)
 * and stays invisible until the row is hovered or the button itself is focused —
 * except when pinned, where it must always show so the state is readable.
 */
function NavRow({
  href,
  label,
  active,
  count,
  pinned,
  pinDisabled = false,
  onTogglePin,
}: {
  href: string;
  label: string;
  active: boolean;
  count?: number;
  pinned: boolean;
  pinDisabled?: boolean;
  onTogglePin: () => void;
}) {
  const ItemIcon = iconForHref(href);
  const PinIcon = pinned ? PinOff : Pin;
  return (
    <li className="group/nav flex items-center gap-0.5">
      <Link
        href={href}
        className={cn(
          'flex min-w-0 flex-1 items-center justify-between gap-2 rounded-md px-2 py-1.5 text-sm transition-colors',
          active
            ? 'bg-primary/10 font-medium text-primary'
            : 'text-foreground/80 hover:bg-accent hover:text-accent-foreground',
        )}
      >
        <span className="flex min-w-0 items-center gap-2">
          <ItemIcon aria-hidden="true" className="size-4 shrink-0 opacity-75" />
          <span className="truncate">{label}</span>
        </span>
        {typeof count === 'number' && count > 0 && (
          <Badge
            variant="destructive"
            className="px-1.5 py-0 text-[10px] leading-5"
          >
            {count}
          </Badge>
        )}
      </Link>
      <button
        type="button"
        onClick={onTogglePin}
        disabled={pinDisabled}
        aria-pressed={pinned}
        aria-label={pinned ? `Unpin ${label}` : `Pin ${label}`}
        title={
          pinDisabled
            ? `Unpin one of your ${MAX_NAV_SHORTCUTS} shortcuts first`
            : pinned
              ? 'Remove from pinned shortcuts'
              : 'Pin to the top of the sidebar'
        }
        className={cn(
          'flex size-7 shrink-0 items-center justify-center rounded-md transition-colors',
          'hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
          'disabled:cursor-not-allowed disabled:text-muted-foreground/40 disabled:hover:bg-transparent',
          pinned
            ? 'text-primary'
            : // Hover-reveal is a desktop affordance; touch has no hover, so on
              // small screens the pin is always visible.
              'text-muted-foreground md:opacity-0 md:group-hover/nav:opacity-100 md:focus-visible:opacity-100',
        )}
      >
        <PinIcon className="size-3.5" />
      </button>
    </li>
  );
}
