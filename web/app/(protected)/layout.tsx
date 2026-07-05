'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useAuth } from '../lib/auth-context';

export default function ProtectedLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { user, loading, logout } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!loading && !user) {
      router.replace('/login');
    }
  }, [loading, user, router]);

  if (loading || !user) {
    return null;
  }

  const isAdmin = user.role === 'ADMIN' || user.role === 'SUPER_ADMIN';
  const isManager = user.role === 'MANAGER';
  const isEmployee = user.role === 'EMPLOYEE';

  return (
    <div>
      <nav
        style={{
          display: 'flex',
          gap: 16,
          padding: '12px 20px',
          borderBottom: '1px solid #ddd',
          alignItems: 'center',
        }}
      >
        {isAdmin && (
          <>
            <Link href="/admin/employees">Employees</Link>
            <Link href="/admin/verticals">Verticals</Link>
          </>
        )}
        {isManager && <Link href="/team">My Team</Link>}
        {isEmployee && <Link href="/profile">My Profile</Link>}
        <span style={{ marginLeft: 'auto', color: '#666' }}>
          {user.email} ({user.role})
        </span>
        <button
          onClick={async () => {
            await logout();
            router.replace('/login');
          }}
        >
          Log out
        </button>
      </nav>
      <main style={{ padding: 20 }}>{children}</main>
    </div>
  );
}
