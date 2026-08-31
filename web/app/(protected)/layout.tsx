'use client';

import { useEffect, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { useAuth } from '../lib/auth-context';
import { useIsHrStaff } from '../lib/use-is-hr-staff';
import { useIsSalesStaff } from '../lib/use-is-sales-staff';
import { useIsSalesHead } from '../lib/use-is-sales-head';
import { useIsRndHead } from '../lib/use-is-rnd-head';
import { useIsRndStaff } from '../lib/use-is-rnd-staff';
import { useIsStoreStaff } from '../lib/use-is-store-staff';
import { useIsScmStaff } from '../lib/use-is-scm-staff';
import { useFinanceAccess } from '../lib/use-finance-access';
import { useQmsAccess } from '../lib/use-qms-access';
import { useDesignAccess } from '../lib/use-design-access';
import { useExecutiveAccess } from '../lib/use-executive-access';
import { usePendingApprovalCounts } from '../lib/use-pending-approval-counts';
import { approvalBadgesByHref } from '../lib/approval-queues';
import {
  activeModule as resolveActiveModule,
  availableModules,
  moduleHome,
  navLeaves,
  sidebarNav,
  type ModuleKey,
} from '../lib/nav';
import { AppTopBar } from '../components/shell/app-top-bar';
import { Sidebar } from '../components/shell/sidebar';
import { ResetPasswordDialog } from '../components/shell/reset-password-dialog';
import { PingWidget } from '../components/shell/ping-widget';
import { InstallBanner } from '../components/pwa/install-banner';
import { PushSubscriptionSync } from '../components/pwa/push-subscription-sync';

export default function ProtectedLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { user, loading } = useAuth();
  // These hooks resolve the SALES/HR vertical membership (same gating as before).
  const { isHrStaff, loading: hrLoading } = useIsHrStaff();
  const { isSalesStaff, loading: salesLoading } = useIsSalesStaff();
  const { isSalesHead, loading: salesHeadLoading } = useIsSalesHead();
  const { isRndHead, loading: rndHeadLoading } = useIsRndHead();
  const { isRndStaff, loading: rndStaffLoading } = useIsRndStaff();
  const { isStoreStaff, loading: storeLoading } = useIsStoreStaff();
  const { isScmStaff, loading: scmLoading } = useIsScmStaff();
  const {
    isFinanceUser,
    isAccountsHead,
    isFinanceAuditor,
    loading: financeLoading,
  } = useFinanceAccess();
  const { isQualityUser, isQmsHead, loading: qmsLoading } = useQmsAccess();
  const {
    isDesignUser,
    isDesignHead,
    loading: designLoading,
  } = useDesignAccess();
  const {
    hasExecutiveDashboardAccess,
    loading: executiveLoading,
  } = useExecutiveAccess();
  const { counts } = usePendingApprovalCounts();
  const router = useRouter();
  const pathname = usePathname();
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  useEffect(() => setMobileNavOpen(false), [pathname]);

  useEffect(() => {
    if (!loading && !user) {
      router.replace('/login');
    }
  }, [loading, user, router]);

  // Wait for auth + vertical checks so the sidebar doesn't briefly render
  // the wrong items on first paint.
  if (
    loading ||
    hrLoading ||
    salesLoading ||
    salesHeadLoading ||
    rndHeadLoading ||
    rndStaffLoading ||
    storeLoading ||
    scmLoading ||
    financeLoading ||
    qmsLoading ||
    designLoading ||
    executiveLoading ||
    !user
  ) {
    return null;
  }

  const payslipsEnabled = process.env.NEXT_PUBLIC_PAYSLIPS_ENABLED === 'true';
  const access = {
    user,
    isHrStaff,
    isSalesStaff,
    isSalesHead,
    isRndHead,
    isRndStaff,
    isStoreStaff,
    isScmStaff,
    isFinanceUser,
    isFinanceAuditor,
    isAccountsHead,
    isQualityUser,
    isQmsHead,
    isDesignUser,
    isDesignHead,
    hasExecutiveDashboardAccess,
    // Surface the Offer Letter Approvals inbox to whoever currently has letters
    // routed to them (vertical owner / Super Admin fallback) — self-cleaning.
    offerLetterApprovalsPending: (counts?.offerLetterApprovals.count ?? 0) > 0,
    payslipsEnabled,
  };

  const modules = availableModules(access);
  // Single-module users always see their module (pathname-independent), so a
  // Sales rep sees the Sales nav even on shared pages like /leave. Only
  // multi-module users (SuperAdmin) resolve the active module from the path.
  const currentModule = resolveActiveModule(pathname, modules);
  const groups = sidebarNav(access, currentModule);
  // The "Jump to" index spans every module the user can reach, not just the
  // active one, so no page is more than a search away from any other page.
  const searchLeaves = navLeaves(access, modules);

  // Join the pending queues to nav items by href. The href mapping (including
  // leaveApprovals covering both the manager and admin queue pages) lives in
  // the shared APPROVAL_QUEUES registry, which the dashboard's urgent banner
  // reads too — so a new queue is badged in both places from one edit.
  const badges = approvalBadgesByHref(counts);

  function switchModule(m: ModuleKey) {
    const target = moduleHome(m, access);
    if (target) router.push(target);
  }

  // Admin force-reset gate: while mustChangePassword is set, the whole app is
  // replaced by the non-dismissable forced-change dialog. The backend blocks
  // every other request too, so this keeps the UI consistent with the API.
  if (user.mustChangePassword) {
    return (
      <div className="flex min-h-screen items-center justify-center p-6">
        <ResetPasswordDialog forced onClose={() => undefined} />
      </div>
    );
  }

  return (
    <div className="flex min-h-screen flex-col">
      <AppTopBar
        user={user}
        modules={modules}
        activeModule={currentModule}
        onSwitchModule={switchModule}
        onOpenNavigation={() => setMobileNavOpen(true)}
      />
      <div className="flex flex-1">
        <Sidebar
          groups={groups}
          searchLeaves={searchLeaves}
          badges={badges}
          mobileOpen={mobileNavOpen}
          onMobileClose={() => setMobileNavOpen(false)}
        />
        <main className="min-w-0 flex-1 overflow-x-hidden p-4 md:p-6">
          {children}
        </main>
        <PingWidget />
      </div>
      {/* Both render nothing until they have something to do: the banner only
      when the app is installable and not already installed, the sync only when
      this browser already holds a push subscription to re-register. */}
      <InstallBanner />
      <PushSubscriptionSync />
    </div>
  );
}
