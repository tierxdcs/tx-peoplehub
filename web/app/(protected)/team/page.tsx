'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth, roleHome } from '../../lib/auth-context';
import { apiFetch } from '../../lib/api';
import { Employee } from '../../lib/types';

export default function TeamPage() {
  const { user, loading: authLoading } = useAuth();
  const router = useRouter();
  const [team, setTeam] = useState<Employee[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const allowed =
    user?.role === 'MANAGER' ||
    user?.role === 'ADMIN' ||
    user?.role === 'SUPER_ADMIN';

  useEffect(() => {
    if (authLoading || !user) return;
    if (!allowed) {
      router.replace(roleHome(user.role));
      return;
    }
    apiFetch<Employee[]>(`/employees/${user.sub}/team`)
      .then(setTeam)
      .catch(() => setError('Failed to load your team'))
      .finally(() => setLoading(false));
  }, [authLoading, user, allowed, router]);

  if (authLoading || !user || !allowed) return null;

  return (
    <div>
      <h1>My Team</h1>
      <p style={{ color: '#666' }}>
        Direct and indirect reports — flat list.
      </p>
      {error && <p style={{ color: 'crimson' }}>{error}</p>}
      {loading ? (
        <p>Loading…</p>
      ) : team.length === 0 ? (
        <p>No reports.</p>
      ) : (
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ textAlign: 'left', borderBottom: '1px solid #ccc' }}>
              <th>Employee ID</th>
              <th>Name</th>
              <th>Role</th>
            </tr>
          </thead>
          <tbody>
            {team.map((e) => (
              <tr key={e.id} style={{ borderBottom: '1px solid #eee' }}>
                <td>{e.employeeId}</td>
                <td>
                  {e.firstName} {e.lastName}
                </td>
                <td>{e.role}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
