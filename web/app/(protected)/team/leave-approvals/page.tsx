'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth, roleHome } from '../../../lib/auth-context';
import { apiFetch, ApiError } from '../../../lib/api';
import {
  Employee,
  LeaveRequest,
  LeaveType,
  PaginatedResult,
} from '../../../lib/types';

/**
 * Backend-enforced scope: /leave-requests/pending-approval is server-shaped
 * (Manager -> direct reports only; a Manager's own request never appears
 * here since the query filters on employee.reportingManagerId === caller,
 * and self-approval is separately blocked at approve/reject time). This
 * page trusts whatever the endpoint returns rather than re-deriving scope.
 */
export default function TeamLeaveApprovalsPage() {
  const { user, loading: authLoading } = useAuth();
  const router = useRouter();
  const allowed =
    user?.role === 'MANAGER' ||
    user?.role === 'ADMIN' ||
    user?.role === 'SUPER_ADMIN';

  const [requests, setRequests] = useState<LeaveRequest[]>([]);
  const [leaveTypes, setLeaveTypes] = useState<LeaveType[]>([]);
  const [employeeNames, setEmployeeNames] = useState<Record<string, string>>(
    {},
  );
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [comments, setComments] = useState<Record<string, string>>({});
  const [acting, setActing] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [reqRes, typesRes] = await Promise.all([
        apiFetch<PaginatedResult<LeaveRequest>>(
          '/leave-requests/pending-approval?page=1&limit=100',
        ),
        apiFetch<LeaveType[]>('/leave-types'),
      ]);
      setRequests(reqRes.items);
      setLeaveTypes(typesRes);

      const ids = [...new Set(reqRes.items.map((r) => r.employeeId))];
      const resolved: Record<string, string> = {};
      await Promise.all(
        ids.map(async (id) => {
          try {
            const emp = await apiFetch<Employee>(`/employees/${id}`);
            resolved[id] = `${emp.firstName} ${emp.lastName}`;
          } catch {
            resolved[id] = id;
          }
        }),
      );
      setEmployeeNames(resolved);
    } catch {
      setError('Failed to load pending approvals');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (authLoading || !user || !allowed) return;
    load();
  }, [authLoading, user, allowed, load]);

  if (authLoading || !user) return null;
  if (!allowed) {
    router.replace(roleHome(user.role));
    return null;
  }

  const leaveTypeName = (id: string) =>
    leaveTypes.find((t) => t.id === id)?.name ?? '—';

  async function act(id: string, action: 'approve' | 'reject') {
    setActing(id);
    try {
      await apiFetch(`/leave-requests/${id}/${action}`, {
        method: 'PATCH',
        body: JSON.stringify({ approverComments: comments[id] || undefined }),
      });
      await load();
    } catch (err) {
      alert(
        err instanceof ApiError ? err.message : `Failed to ${action} request`,
      );
    } finally {
      setActing(null);
    }
  }

  return (
    <div>
      <h1>Team Leave Approvals</h1>

      {error && <p style={{ color: 'crimson' }}>{error}</p>}
      {loading ? (
        <p>Loading…</p>
      ) : requests.length === 0 ? (
        <p>No pending requests.</p>
      ) : (
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ textAlign: 'left', borderBottom: '1px solid #ccc' }}>
              <th>Employee</th>
              <th>Type</th>
              <th>Dates</th>
              <th>Days</th>
              <th>Reason</th>
              <th>Requested</th>
              <th>Comment</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {requests.map((r) => (
              <tr key={r.id} style={{ borderBottom: '1px solid #eee' }}>
                <td>{employeeNames[r.employeeId] ?? '…'}</td>
                <td>{leaveTypeName(r.leaveTypeId)}</td>
                <td>
                  {r.startDate.slice(0, 10)} → {r.endDate.slice(0, 10)}
                </td>
                <td>{r.numberOfDays}</td>
                <td>{r.reason}</td>
                <td>{new Date(r.createdAt).toLocaleDateString()}</td>
                <td>
                  <input
                    placeholder="Optional comment"
                    value={comments[r.id] ?? ''}
                    onChange={(e) =>
                      setComments((c) => ({ ...c, [r.id]: e.target.value }))
                    }
                    style={{ padding: 4, width: 140 }}
                  />
                </td>
                <td style={{ display: 'flex', gap: 4 }}>
                  <button
                    disabled={acting === r.id}
                    onClick={() => act(r.id, 'approve')}
                  >
                    Approve
                  </button>
                  <button
                    disabled={acting === r.id}
                    onClick={() => act(r.id, 'reject')}
                  >
                    Reject
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
