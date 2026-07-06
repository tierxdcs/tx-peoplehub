'use client';

import { useEffect } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { useAuth } from '../lib/auth-context';
import { useIsHrStaff } from '../lib/use-is-hr-staff';
import { useIsSalesStaff } from '../lib/use-is-sales-staff';
import { useIsSalesHead } from '../lib/use-is-sales-head';
import {
  activeModule as resolveActiveModule,
  availableModules,
  moduleHome,
  sidebarNav,
  type ModuleKey,
} from '../lib/nav';
import { AppTopBar } from '../components/shell/app-top-bar';
import { Sidebar } from '../components/shell/sidebar';

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
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (!loading && !user) {
      router.replace('/login');
    }
  }, [loading, user, router]);

  // Wait for auth + vertical checks so the sidebar doesn't briefly render
  // the wrong items on first paint.
  if (loading || hrLoading || salesLoading || salesHeadLoading || !user) {
    return null;
  }

  const payslipsEnabled = process.env.NEXT_PUBLIC_PAYSLIPS_ENABLED === 'true';
  const access = {
    user,
    isHrStaff,
    isSalesStaff,
    isSalesHead,
    payslipsEnabled,
  };

  const modules = availableModules(access);
  // Single-module users always see their module (pathname-independent), so a
  // Sales rep sees the Sales nav even on shared pages like /leave. Only
  // multi-module users (SuperAdmin) resolve the active module from the path.
  const currentModule = resolveActiveModule(pathname, modules);
  const groups = sidebarNav(access, currentModule);

  function switchModule(m: ModuleKey) {
    const target = moduleHome(m, access);
    if (target) router.push(target);
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
        <Sidebar groups={groups} />
        <main className="flex-1 overflow-x-auto p-6">{children}</main>
      </div>
    </div>
  );
}
