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
    // isSalesHead doesn't affect the landing route (only the assessment-queue
    // nav item), so it's safely false here.
    router.replace(
      landingRoute({
        user,
        isHrStaff,
        isSalesStaff,
        isSalesHead: false,
        payslipsEnabled,
      }),
    );
  }, [loading, hrLoading, salesLoading, user, isHrStaff, isSalesStaff, router]);

  return null;
}
