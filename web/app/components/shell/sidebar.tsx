'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { NavGroup } from '../../lib/nav';
import { cn } from '../../lib/utils';

/**
 * Per-module left nav. Renders only the groups/items passed in (already
 * gated by the nav model), highlighting the active route. Longest-prefix
 * match so e.g. /sales/bids/new keeps "Bids" active.
 */
export function Sidebar({ groups }: { groups: NavGroup[] }) {
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
                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      className={cn(
                        'block rounded-md px-2 py-1.5 text-sm transition-colors',
                        active
                          ? 'bg-primary/10 font-medium text-primary'
                          : 'text-foreground/80 hover:bg-accent hover:text-accent-foreground',
                      )}
                    >
                      {item.label}
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
