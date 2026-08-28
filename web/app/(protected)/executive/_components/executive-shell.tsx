'use client';

/**
 * The shared shell for the Executive Dashboards section.
 *
 * Everything section-wide lives here exactly once — the access gate
 * (useExecutiveAccess → the CEO-granted hasExecutiveDashboardAccess flag), the
 * page surface, the header, and the tab strip. Adding the planned Finance or
 * Production dashboard is therefore: one entry in EXECUTIVE_DASHBOARDS below, one
 * new page that renders <ExecutiveShell>, one backend route behind the same
 * ExecutiveAccessService. No new access mechanism, no new page chrome.
 */

import Link from 'next/link';
import {
  SignalChip,
  SignalHeader,
  SignalPage,
  SIGNAL_MUTED,
} from '../../../components/ui/signal';
import { cn } from '../../../lib/utils';
import { useExecutiveAccess } from '../../../lib/use-executive-access';

/** Every dashboard in the section. Add future dashboards here. */
export const EXECUTIVE_DASHBOARDS = [
  { key: 'sales', label: 'Sales', href: '/executive/sales' },
  { key: 'operations', label: 'Operations', href: '/executive/operations' },
] as const;

export type ExecutiveDashboardKey = (typeof EXECUTIVE_DASHBOARDS)[number]['key'];

export function ExecutiveShell({
  active,
  title,
  description,
  chip,
  actions,
  children,
}: {
  active: ExecutiveDashboardKey;
  title: React.ReactNode;
  description?: React.ReactNode;
  chip?: React.ReactNode;
  actions?: React.ReactNode;
  children: React.ReactNode;
}) {
  const { hasExecutiveDashboardAccess, loading } = useExecutiveAccess();

  // Render nothing while the grant is being read, so a user who does have access
  // never sees a "no access" flash.
  if (loading) return null;

  if (!hasExecutiveDashboardAccess) {
    return (
      <SignalPage>
        <SignalHeader title="Executive Dashboards" />
        <div className="space-y-4 px-5 pb-7 pt-[18px] lg:px-7">
          <p className={cn('text-[13px]', SIGNAL_MUTED)}>
            Executive Dashboards access has not been granted for your account.
          </p>
        </div>
      </SignalPage>
    );
  }

  return (
    <SignalPage>
      <SignalHeader
        title={title}
        description={description}
        chip={chip}
        actions={actions}
      />
      {EXECUTIVE_DASHBOARDS.length > 1 && (
        <div className="flex flex-wrap items-center gap-1.5 border-b border-black/10 bg-[#ECECEC] px-5 py-2 lg:px-7 dark:border-white/[.07] dark:bg-[#1F1F1F]">
          {EXECUTIVE_DASHBOARDS.map((dashboard) => (
            <Link
              key={dashboard.key}
              href={dashboard.href}
              className={cn(
                'rounded-[5px] px-2.5 py-1 text-[12px] font-medium',
                dashboard.key === active
                  ? 'bg-black/[.09] text-black/80 dark:bg-white/[.11] dark:text-white/85'
                  : 'text-black/45 hover:text-black/70 dark:text-white/45 dark:hover:text-white/70',
              )}
            >
              {dashboard.label}
            </Link>
          ))}
        </div>
      )}
      <div className="space-y-4 px-5 pb-7 pt-[18px] lg:px-7">{children}</div>
    </SignalPage>
  );
}

/** Re-exported so pages don't need a second import for the header chip. */
export { SignalChip };
