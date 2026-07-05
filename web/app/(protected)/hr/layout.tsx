'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth, roleHome } from '../../lib/auth-context';
import { useIsHrStaff } from '../../lib/use-is-hr-staff';

/** Gates /hr/* to Admin/SuperAdmin or HR-vertical Manager/Employee. */
export default function HrLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { user, loading: authLoading } = useAuth();
  const { isHrStaff, loading: hrLoading } = useIsHrStaff();
  const router = useRouter();

  const loading = authLoading || hrLoading;
  const isAdmin = user?.role === 'ADMIN' || user?.role === 'SUPER_ADMIN';
  const allowed = isAdmin || isHrStaff;

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
