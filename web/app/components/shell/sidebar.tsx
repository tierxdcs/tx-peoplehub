'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  ArrowLeftRight,
  BadgeCheck,
  Banknote,
  BarChart3,
  Boxes,
  Building2,
  CalendarDays,
  CalendarRange,
  CheckSquare2,
  ChevronDown,
  ClipboardCheck,
  ClipboardList,
  Columns3,
  ContactRound,
  FileCheck2,
  FileText,
  FolderOpen,
  Gauge,
  IndianRupee,
  LayoutDashboard,
  ListChecks,
  BookOpen,
  Package,
  PackageCheck,
  ReceiptText,
  Rocket,
  ScrollText,
  Settings2,
  ShieldCheck,
  ShoppingCart,
  Target,
  Truck,
  UserPlus,
  Users,
  UsersRound,
  Warehouse,
  Wrench,
  Workflow,
  X,
  type LucideIcon,
} from 'lucide-react';
import type { NavGroup } from '../../lib/nav';
import { cn } from '../../lib/utils';
import { Badge } from '../ui/badge';

const COLLAPSE_KEY = 'sidebar:collapsedGroups';

/**
 * Route-aware icon selection keeps the nav model serializable and guarantees
 * every current/future menu entry receives an icon. More-specific routes must
 * be checked before their broader module prefixes.
 */
function iconForHref(href: string): LucideIcon {
  if (href === '/dashboard') return LayoutDashboard;
  if (href === '/help') return BookOpen;
  if (href === '/vault' || href.includes('/documents')) return FolderOpen;
  if (href === '/kanban') return Columns3;
  if (href.includes('/sprints')) return CalendarRange;
  if (href === '/project-kickoff') return Rocket;
  if (href === '/plm') return Workflow;

  if (href.includes('pending-approval') || href.includes('leave-approvals'))
    return BadgeCheck;
  if (href.includes('attendance')) return CalendarDays;
  if (href.includes('employees') || href.includes('/roster')) return Users;
  if (href.includes('onboard') || href.includes('pending-access'))
    return UserPlus;
  if (href.includes('verticals')) return Building2;
  if (href.includes('auditor')) return ShieldCheck;
  if (
    href.includes('payroll') ||
    href.includes('salary') ||
    href.includes('payslip')
  )
    return IndianRupee;
  if (href.includes('statutory')) return ScrollText;

  if (href.includes('/leads')) return ContactRound;
  if (href.includes('/opportunities')) return Target;
  if (href.includes('/bids') || href.includes('confirmation-sheets'))
    return FileText;
  if (href.includes('/orders') || href.includes('purchase-orders'))
    return ShoppingCart;
  if (href.includes('/customers')) return Building2;
  if (href.includes('/products') || href.includes('/items')) return Package;

  if (href.includes('/vendors') || href.includes('/suppliers'))
    return UsersRound;
  if (href.includes('/rfqs')) return FileCheck2;
  if (href.includes('/bom')) return Boxes;
  if (href.includes('/inventory')) return Warehouse;
  if (href.includes('/grn')) return PackageCheck;
  if (href.includes('material-issue')) return Warehouse;
  if (href.includes('/dispatch')) return Truck;
  if (href.includes('/otd')) return Gauge;

  if (href.includes('/daybook')) return ScrollText;
  if (href.includes('/contra')) return ArrowLeftRight;
  if (href.includes('/invoices') || href.includes('/adjustments'))
    return ReceiptText;
  if (href.includes('/payments') || href.includes('/receipts')) return Banknote;
  if (href.includes('calendar')) return CalendarDays;
  if (href.includes('/accounts') || href.includes('/journals'))
    return ScrollText;
  if (
    href.includes('/reports') ||
    href.includes('/analytics') ||
    href.includes('/summary')
  )
    return BarChart3;
  if (
    href.includes('compliance') ||
    href.includes('filings') ||
    href.includes('period-close')
  )
    return ShieldCheck;

  if (href.includes('/inspections') || href.includes('/audits'))
    return ClipboardCheck;
  if (href.includes('/plans') || href.includes('/templates'))
    return ClipboardList;
  if (
    href.includes('/ncr') ||
    href.includes('/capas') ||
    href.includes('/complaints')
  )
    return Wrench;
  if (href.includes('/calibration')) return Gauge;
  if (href.includes('/design')) return Settings2;

  return CheckSquare2;
}

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
  mobileOpen = false,
  onMobileClose,
}: {
  groups: NavGroup[];
  badges?: Record<string, number>;
  mobileOpen?: boolean;
  onMobileClose?: () => void;
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

  const allItems = groups.flatMap((group) => group.items);
  const quickItems = allItems.filter(
    (item, index, items) =>
      (item.href === '/dashboard' ||
        item.href === '/kanban' ||
        item.href.includes('pending-approval') ||
        item.href.includes('leave-approvals')) &&
      items.findIndex((candidate) => candidate.href === item.href) === index,
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
      <aside
        className={cn(
          'fixed bottom-0 left-0 top-14 z-50 w-[min(20rem,86vw)] shrink-0 overflow-y-auto border-r bg-card transition-transform md:static md:z-auto md:w-60 md:translate-x-0',
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
                      const ItemIcon = iconForHref(item.href);
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
                            <span className="flex min-w-0 items-center gap-2">
                              <ItemIcon
                                aria-hidden="true"
                                className="size-4 shrink-0 opacity-75"
                              />
                              <span className="truncate">{item.label}</span>
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
    </>
  );
}
