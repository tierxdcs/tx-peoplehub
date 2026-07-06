'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth, roleHome } from '../../lib/auth-context';
import { useIsSalesStaff } from '../../lib/use-is-sales-staff';

/** Gates /sales/* to SUPER_ADMIN or SALES-vertical Manager/Employee. */
export default function SalesLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { user, loading: authLoading } = useAuth();
  const { isSalesStaff, loading: salesLoading } = useIsSalesStaff();
  const router = useRouter();

  const loading = authLoading || salesLoading;
  // Per spec §4 Visibility: SUPER_ADMIN sees everything; plain ADMIN has NO
  // Sales visibility (account-management-only), so it is NOT allowed here.
  const isSuperAdmin = user?.role === 'SUPER_ADMIN';
  const allowed = isSuperAdmin || isSalesStaff;

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
