'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useAuth } from '../lib/auth-context';
import { useIsHrStaff } from '../lib/use-is-hr-staff';

export default function ProtectedLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { user, loading, logout } = useAuth();
  const { isHrStaff } = useIsHrStaff();
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
  // Payroll module spec §5: employee-facing payslip access stays off until
  // StatutoryConfig rates have CA/compliance sign-off.
  const payslipsEnabled = process.env.NEXT_PUBLIC_PAYSLIPS_ENABLED === 'true';

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
            <Link href="/hr/roster">Roster</Link>
            <Link href="/admin/pending-access">Pending Access</Link>
          </>
        )}
        {isManager && <Link href="/team">My Team</Link>}
        {isEmployee && <Link href="/profile">My Profile</Link>}
        {isHrStaff && (
          <>
            <Link href="/hr/roster">Roster</Link>
            <Link href="/hr/onboard">Onboard Employee</Link>
          </>
        )}
        <Link href="/leave">My Leave</Link>
        <Link href="/attendance">My Attendance</Link>
        {isManager && (
          <>
            <Link href="/team/leave-approvals">Team Leave Approvals</Link>
            <Link href="/team/attendance">Team Attendance</Link>
          </>
        )}
        {isAdmin && (
          <>
            <Link href="/admin/leave-approvals">All Pending Approvals</Link>
            <Link href="/admin/attendance-corrections">
              Attendance Corrections
            </Link>
            <Link href="/admin/salary-structures">Salary Structures</Link>
            <Link href="/admin/payroll-runs">Payroll Runs</Link>
            <Link href="/admin/statutory-config">Statutory Config</Link>
          </>
        )}
        {payslipsEnabled && <Link href="/payslips">My Payslips</Link>}
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
