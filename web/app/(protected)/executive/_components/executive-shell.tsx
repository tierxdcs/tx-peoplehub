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

import { useEffect, useRef, useState } from 'react';
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
  { key: 'project-management', label: 'Project Management', href: '/executive/project-management' },
  { key: 'scm', label: 'SCM', href: '/executive/scm' },
] as const;

export type ExecutiveDashboardKey = (typeof EXECUTIVE_DASHBOARDS)[number]['key'];

/**
 * Spacer height used for the one frame before the chrome is measured. Only has
 * to be close: it is replaced by the real height in the first effect.
 */
const CHROME_FALLBACK_PX = 118;

export function ExecutiveShell({
  active,
  title,
  description,
  chip,
  actions,
  fixedHeader = false,
  toolbar,
  children,
}: {
  active: ExecutiveDashboardKey;
  title: React.ReactNode;
  description?: React.ReactNode;
  chip?: React.ReactNode;
  actions?: React.ReactNode;
  fixedHeader?: boolean;
  /**
   * Per-dashboard controls (filters, the section jump-nav) that must stay on
   * screen with the header. Rendered as the last band of the fixed chrome, so it
   * is always flush against the tab strip — a dashboard must never position this
   * itself, which is what left a gap under the tabs for content to scroll
   * through.
   */
  toolbar?: React.ReactNode;
  children: React.ReactNode;
}) {
  const { hasExecutiveDashboardAccess, loading } = useExecutiveAccess();
  const chromeRef = useRef<HTMLDivElement>(null);
  const [chromeHeight, setChromeHeight] = useState(CHROME_FALLBACK_PX);

  /**
   * The fixed chrome is out of flow, so the page below needs a spacer exactly as
   * tall as it is — and the anchor targets need the same figure as their
   * scroll-margin. Both are measured rather than hardcoded: the height changes
   * with the toolbar's contents, with a wrapping description, and between
   * breakpoints, and every hardcoded guess was wrong at some width.
   */
  useEffect(() => {
    const element = chromeRef.current;
    if (!fixedHeader || !element) return;
    const measure = () => setChromeHeight(element.offsetHeight);
    measure();
    // The observer covers everything after mount — a toolbar arriving with the
    // data, a filter row wrapping, a resize — so nothing else has to re-measure.
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
    // `loading` is a dependency because the chrome only exists once the access
    // grant has resolved and this component stops rendering null.
  }, [fixedHeader, loading]);

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
    <SignalPage
      // Anchor targets offset themselves by exactly the chrome they must clear.
      style={
        {
          '--exec-chrome-height': `${fixedHeader ? chromeHeight : 0}px`,
        } as React.CSSProperties
      }
    >
      <div
        ref={chromeRef}
        className={cn(
          fixedHeader && 'fixed left-0 right-0 top-14 z-30 md:left-60',
        )}
      >
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
        {toolbar && (
          <div className="border-b border-black/10 bg-white px-5 py-2 lg:px-7 dark:border-white/[.09] dark:bg-[#1d1d1d]">
            {toolbar}
          </div>
        )}
      </div>
      {fixedHeader && (
        <div style={{ height: chromeHeight }} aria-hidden="true" />
      )}
      <div className="space-y-4 px-5 pb-7 pt-[18px] lg:px-7">{children}</div>
    </SignalPage>
  );
}

/** Re-exported so pages don't need a second import for the header chip. */
export { SignalChip };
