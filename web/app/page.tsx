'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from './lib/auth-context';
import { useIsHrStaff } from './lib/use-is-hr-staff';
import { useIsSalesStaff } from './lib/use-is-sales-staff';
import { landingRoute } from './lib/nav';

export default function RootPage() {
  const { user, loading } = useAuth();
  // Vertical membership is needed for module-aware landing (a Sales rep should
  // land in Sales, not a shared page), so wait for these before redirecting.
  const { isHrStaff, loading: hrLoading } = useIsHrStaff();
  const { isSalesStaff, loading: salesLoading } = useIsSalesStaff();
  const router = useRouter();

  useEffect(() => {
    if (loading || hrLoading || salesLoading) return;
    if (!user) {
      router.replace('/login');
      return;
    }
    const payslipsEnabled = process.env.NEXT_PUBLIC_PAYSLIPS_ENABLED === 'true';
    // isSalesHead / isRndHead don't affect the landing route (they only gate
    // approval-queue nav items), so they're safely false here.
    router.replace(
      landingRoute({
        user,
        isHrStaff,
        isSalesStaff,
        isSalesHead: false,
        isRndHead: false,
        isFinanceUser: false,
        isAccountsHead: false,
        isRndStaff: false,
        isStoreStaff: false,
        payslipsEnabled,
      }),
    );
  }, [loading, hrLoading, salesLoading, user, isHrStaff, isSalesStaff, router]);

  return null;
}
