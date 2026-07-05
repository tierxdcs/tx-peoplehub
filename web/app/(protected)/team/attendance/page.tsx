'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth, roleHome } from '../../../lib/auth-context';
import { apiFetch } from '../../../lib/api';
import { addDaysStr, todayDateStr } from '../../../lib/date';
import { Attendance, Employee } from '../../../lib/types';

/**
 * GET /attendance/team is Manager-only on the backend (unlike almost every
 * other "team" endpoint in this app) — gated to MANAGER here to match, not
 * Admin/SuperAdmin too.
 */
export default function TeamAttendancePage() {
  const { user, loading: authLoading } = useAuth();
  const router = useRouter();
  const allowed = user?.role === 'MANAGER';

  const [from, setFrom] = useState(addDaysStr(todayDateStr(), -6));
  const [to, setTo] = useState(todayDateStr());
  const [records, setRecords] = useState<Attendance[]>([]);
  const [team, setTeam] = useState<Employee[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    setError(null);
    try {
      const [recordsRes, teamRes] = await Promise.all([
        apiFetch<Attendance[]>(
          `/attendance/team?from=${from}&to=${to}`,
        ),
        apiFetch<Employee[]>(`/employees/${user.sub}/team`),
      ]);
      setRecords(recordsRes);
      setTeam(teamRes);
    } catch {
      setError('Failed to load team attendance');
    } finally {
      setLoading(false);
    }
  }, [from, to, user]);

  useEffect(() => {
    if (authLoading || !user || !allowed) return;
    load();
  }, [authLoading, user, allowed, load]);

  if (authLoading || !user) return null;
  if (!allowed) {
    router.replace(roleHome(user.role));
    return null;
  }

  const dates: string[] = [];
  for (let d = from; d <= to; d = addDaysStr(d, 1)) {
    dates.push(d);
    if (dates.length > 60) break; // sane cap on the grid width
  }

  const statusFor = (employeeId: string, date: string) =>
    records.find(
      (r) => r.employeeId === employeeId && r.date.slice(0, 10) === date,
    )?.status ?? '—';

  return (
    <div>
      <h1>Team Attendance</h1>

      <div style={{ display: 'flex', gap: 12, marginBottom: 16 }}>
        <label>
          From{' '}
          <input
            type="date"
            value={from}
            max={to}
            onChange={(e) => setFrom(e.target.value)}
          />
        </label>
        <label>
          To{' '}
          <input
            type="date"
            value={to}
            min={from}
            onChange={(e) => setTo(e.target.value)}
          />
        </label>
      </div>

      {error && <p style={{ color: 'crimson' }}>{error}</p>}
      {loading ? (
        <p>Loading…</p>
      ) : team.length === 0 ? (
        <p>No reports.</p>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ textAlign: 'left', borderBottom: '1px solid #ccc' }}>
                <th style={{ padding: 4 }}>Employee</th>
                {dates.map((d) => (
                  <th key={d} style={{ padding: 4, fontSize: 12 }}>
                    {d.slice(5)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {team.map((e) => (
                <tr key={e.id} style={{ borderBottom: '1px solid #eee' }}>
                  <td style={{ padding: 4 }}>
                    {e.firstName} {e.lastName}
                  </td>
                  {dates.map((d) => (
                    <td
                      key={d}
                      style={{ padding: 4, fontSize: 12, textAlign: 'center' }}
                    >
                      {statusFor(e.id, d)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
