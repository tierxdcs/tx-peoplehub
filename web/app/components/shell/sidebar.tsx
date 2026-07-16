'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ChevronDown } from 'lucide-react';
import type { NavGroup } from '../../lib/nav';
import { cn } from '../../lib/utils';
import { Badge } from '../ui/badge';

const COLLAPSE_KEY = 'sidebar:collapsedGroups';

/**
 * Per-module left nav. Renders only the groups/items passed in (already
 * gated by the nav model), highlighting the active route. Longest-prefix
 * match so e.g. /sales/bids/new keeps "Bids" active.
 *
 * Each group heading is a collapsible toggle: clicking it hides/shows that
 * group's items. Collapse state is per-heading and persisted to localStorage
 * so it survives navigation; the group containing the active route is always
 * forced open so the current page is never hidden.
 *
 * `badges` maps a nav item's href to a pending count; items with a count > 0
 * render a small numeric pill at the right of the row (hidden when 0/absent).
 */
export function Sidebar({
  groups,
  badges,
}: {
  groups: NavGroup[];
  badges?: Record<string, number>;
}) {
  const pathname = usePathname();

  // Set of collapsed group headings. Hydrated from localStorage after mount
  // (kept empty on first render so server and client markup match).
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  useEffect(() => {
    try {
      const raw = localStorage.getItem(COLLAPSE_KEY);
      if (raw) setCollapsed(new Set(JSON.parse(raw) as string[]));
    } catch {
      /* ignore malformed / unavailable storage */
    }
  }, []);

  function toggle(heading: string) {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(heading)) next.delete(heading);
      else next.add(heading);
      try {
        localStorage.setItem(COLLAPSE_KEY, JSON.stringify([...next]));
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

  return (
    <aside className="w-60 shrink-0 border-r bg-card">
      <nav className="flex flex-col gap-4 p-4">
        {groups.map((group) => {
          // Never hide the group that holds the current page.
          const hasActive = group.items.some((i) => i.href === activeHref);
          const isCollapsed = collapsed.has(group.heading) && !hasActive;
          return (
            <div key={group.heading}>
              <button
                type="button"
                onClick={() => toggle(group.heading)}
                aria-expanded={!isCollapsed}
                className="mb-1 flex w-full items-center justify-between gap-2 rounded-md px-2 py-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground transition-colors hover:text-foreground"
              >
                <span>{group.heading}</span>
                <ChevronDown
                  className={cn(
                    'h-3.5 w-3.5 shrink-0 transition-transform',
                    isCollapsed && '-rotate-90',
                  )}
                />
              </button>
              {!isCollapsed && (
                <ul className="flex flex-col gap-0.5">
                  {group.items.map((item) => {
                    const active = item.href === activeHref;
                    const count = badges?.[item.href];
                    return (
                      <li key={item.href}>
                        <Link
                          href={item.href}
                          className={cn(
                            'flex items-center justify-between gap-2 rounded-md px-2 py-1.5 text-sm transition-colors',
                            active
                              ? 'bg-primary/10 font-medium text-primary'
                              : 'text-foreground/80 hover:bg-accent hover:text-accent-foreground',
                          )}
                        >
                          <span>{item.label}</span>
                          {typeof count === 'number' && count > 0 && (
                            <Badge
                              variant="destructive"
                              className="px-1.5 py-0 text-[10px] leading-5"
                            >
                              {count}
                            </Badge>
                          )}
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          );
        })}
      </nav>
    </aside>
  );
}
