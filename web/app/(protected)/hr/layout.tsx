'use client';

import { useEffect } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { useAuth, roleHome } from '../../lib/auth-context';
import { useIsHrStaff } from '../../lib/use-is-hr-staff';

/**
 * Cross-vertical approval routes that live under /hr for URL grouping but are
 * NOT HR-function pages: they are approval inboxes routed to whichever vertical
 * owner (in any vertical) a requisition/provisioning request belongs to. They
 * surface in the shared "Approvals" nav for everyone, self-guard each section,
 * and are backed by role- and owner-checked endpoints — so the HR-only gate
 * below must not apply to them (it would bounce a non-HR Manager owner to their
 * role home).
 */
const CROSS_VERTICAL_APPROVAL_PREFIXES = [
  '/hr/candidate-requisitions',
  '/hr/provisioning-approvals',
];

/**
 * Gates /hr/* to Admin/SuperAdmin or HR-vertical Manager/Employee — except the
 * cross-vertical approval routes above, which any authenticated user may reach
 * (their audience spans every vertical; the pages and API self-guard).
 */
export default function HrLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { user, loading: authLoading } = useAuth();
  const { isHrStaff, loading: hrLoading } = useIsHrStaff();
  const router = useRouter();
  const pathname = usePathname();

  const loading = authLoading || hrLoading;
  const isAdmin = user?.role === 'ADMIN' || user?.role === 'SUPER_ADMIN';
  const isCrossVerticalApproval = CROSS_VERTICAL_APPROVAL_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
  const allowed = isAdmin || isHrStaff || isCrossVerticalApproval;

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
