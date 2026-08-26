'use client';

import { useEffect } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { useAuth, roleHome } from '../../lib/auth-context';
import { useIsHrStaff } from '../../lib/use-is-hr-staff';
import { isCrossVerticalApprovalRoute } from '../../lib/hr-route-access';

/**
 * Gates /hr/* to Admin/SuperAdmin or HR-vertical Manager/Employee — except the
 * cross-vertical approval routes (see lib/hr-route-access), which any
 * authenticated user may reach: their audience spans every vertical, and the
 * pages and API self-guard by identity.
 */
export default function HrLayout({ children }: { children: React.ReactNode }) {
  const { user, loading: authLoading } = useAuth();
  const { isHrStaff, loading: hrLoading } = useIsHrStaff();
  const router = useRouter();
  const pathname = usePathname();

  const loading = authLoading || hrLoading;
  const isAdmin = user?.role === 'ADMIN' || user?.role === 'SUPER_ADMIN';
  const allowed =
    isAdmin || isHrStaff || isCrossVerticalApprovalRoute(pathname);

  useEffect(() => {
    if (!loading && user && !allowed) {
      router.replace(roleHome(user.role));
    }
  }, [loading, user, allowed, router]);

  if (loading || !user || !allowed) {
    return null;
  }

  return <>{children}</>;
}
