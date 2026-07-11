'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { NavGroup } from '../../lib/nav';
import { cn } from '../../lib/utils';
import { Badge } from '../ui/badge';

/**
 * Per-module left nav. Renders only the groups/items passed in (already
 * gated by the nav model), highlighting the active route. Longest-prefix
 * match so e.g. /sales/bids/new keeps "Bids" active.
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

  const activeHref = groups
    .flatMap((g) => g.items)
    .map((i) => i.href)
    .filter((href) => pathname === href || pathname.startsWith(href + '/'))
    .sort((a, b) => b.length - a.length)[0];

  return (
    <aside className="w-60 shrink-0 border-r bg-card">
      <nav className="flex flex-col gap-6 p-4">
        {groups.map((group) => (
          <div key={group.heading}>
            <p className="mb-1 px-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              {group.heading}
            </p>
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
          </div>
        ))}
      </nav>
    </aside>
  );
}
