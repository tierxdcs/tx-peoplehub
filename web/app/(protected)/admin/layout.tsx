'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth, roleHome } from '../../lib/auth-context';
import { useIsHrStaff } from '../../lib/use-is-hr-staff';

/**
 * Gate for the /admin/* area. ADMIN/SUPER_ADMIN always pass. HR-vertical
 * MANAGERS are also allowed in, because they run the People / Leave &
 * Attendance / Payroll HR functions here — the backend re-enforces the exact
 * same "Admin or HR Manager" rule on every endpoint (HrManagerOrAdminGuard),
 * so this guard only decides what's reachable, never what's authorized.
 */
export default function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { user, loading } = useAuth();
  const { isHrStaff, loading: hrLoading } = useIsHrStaff();
  const router = useRouter();

  const isAdmin = user?.role === 'ADMIN' || user?.role === 'SUPER_ADMIN';
  const isHrManager = isHrStaff && user?.role === 'MANAGER';
  const allowed = isAdmin || isHrManager;

  useEffect(() => {
    if (!loading && !hrLoading && user && !allowed) {
      router.replace(roleHome(user.role));
    }
  }, [loading, hrLoading, user, allowed, router]);

  if (loading || hrLoading || !user || !allowed) {
    return null;
  }

  return <>{children}</>;
}
