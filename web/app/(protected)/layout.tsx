'use client';

import { useEffect } from 'react';
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
import { usePendingApprovalCounts } from '../lib/use-pending-approval-counts';
import {
  activeModule as resolveActiveModule,
  availableModules,
  moduleHome,
  sidebarNav,
  type ModuleKey,
} from '../lib/nav';
import { AppTopBar } from '../components/shell/app-top-bar';
import { Sidebar } from '../components/shell/sidebar';
import { ResetPasswordDialog } from '../components/shell/reset-password-dialog';

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
  const { isDesignUser, isDesignHead, loading: designLoading } = useDesignAccess();
  const { counts } = usePendingApprovalCounts();
  const router = useRouter();
  const pathname = usePathname();

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
    payslipsEnabled,
  };

  const modules = availableModules(access);
  // Single-module users always see their module (pathname-independent), so a
  // Sales rep sees the Sales nav even on shared pages like /leave. Only
  // multi-module users (SuperAdmin) resolve the active module from the path.
  const currentModule = resolveActiveModule(pathname, modules);
  const groups = sidebarNav(access, currentModule);

  // Join the pending counts to nav items by href. leaveApprovals maps to both
  // the manager and admin queues — a given user only sees one, so mapping to
  // both hrefs is safe.
  const badges: Record<string, number> = counts
    ? {
        '/team/leave-approvals': counts.leaveApprovals,
        '/admin/leave-approvals': counts.leaveApprovals,
        '/admin/pending-access': counts.hrPendingAccess,
        '/sales/bids/pending-approval': counts.bidDiscountApprovals,
        '/sales/bid-assessments/pending-approval':
          counts.bidAssessmentApprovals,
        '/sales/confirmation-sheets/pending-approval':
          counts.confirmationSheetsPending,
      }
    : {};

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
      />
      <div className="flex flex-1">
        <Sidebar groups={groups} badges={badges} />
        <main className="flex-1 overflow-x-auto p-6">{children}</main>
      </div>
    </div>
  );
}
