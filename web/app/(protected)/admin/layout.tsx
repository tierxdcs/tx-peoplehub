'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth, roleHome } from '../../lib/auth-context';

export default function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { user, loading } = useAuth();
  const router = useRouter();

  const isAdmin = user?.role === 'ADMIN' || user?.role === 'SUPER_ADMIN';

  useEffect(() => {
    if (!loading && user && !isAdmin) {
      router.replace(roleHome(user.role));
    }
  }, [loading, user, isAdmin, router]);

  if (loading || !user || !isAdmin) {
    return null;
  }

  return <>{children}</>;
}
