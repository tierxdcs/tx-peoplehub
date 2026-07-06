'use client';

import { useCallback, useEffect, useState } from 'react';
import { apiFetch, ApiError } from '../../../lib/api';
import {
  Employee,
  LeaveRequest,
  LeaveType,
  PaginatedResult,
  Vertical,
} from '../../../lib/types';
import { useToast } from '../../../components/ui/toaster';
import { useConfirm } from '../../../components/ui/confirm';

/**
 * Same /leave-requests/pending-approval endpoint as the Manager screen —
 * the backend returns every PENDING request company-wide for Admin/
 * SuperAdmin callers (no reportingManagerId filter applied server-side).
 * The vertical filter here is client-side only, over that full result set.
 */
export default function AdminLeaveApprovalsPage() {
  const toast = useToast();
  const confirm = useConfirm();
  const [requests, setRequests] = useState<LeaveRequest[]>([]);
  const [leaveTypes, setLeaveTypes] = useState<LeaveType[]>([]);
  const [verticals, setVerticals] = useState<Vertical[]>([]);
  const [employees, setEmployees] = useState<Record<string, Employee>>({});
  const [verticalFilter, setVerticalFilter] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [comments, setComments] = useState<Record<string, string>>({});
  const [acting, setActing] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [reqRes, typesRes, verticalsRes] = await Promise.all([
        apiFetch<PaginatedResult<LeaveRequest>>(
          '/leave-requests/pending-approval?page=1&limit=100',
        ),
        apiFetch<LeaveType[]>('/leave-types'),
        apiFetch<Vertical[]>('/verticals'),
      ]);
      setRequests(reqRes.items);
      setLeaveTypes(typesRes);
      setVerticals(verticalsRes);

      const ids = [...new Set(reqRes.items.map((r) => r.employeeId))];
      const resolved: Record<string, Employee> = {};
      await Promise.all(
        ids.map(async (id) => {
          try {
            resolved[id] = await apiFetch<Employee>(`/employees/${id}`);
          } catch {
            // leave unresolved; rendered as the raw id
          }
        }),
      );
      setEmployees(resolved);
    } catch {
      setError('Failed to load pending approvals');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const leaveTypeName = (id: string) =>
    leaveTypes.find((t) => t.id === id)?.name ?? '—';
  const verticalName = (id: string | null) =>
    verticals.find((v) => v.id === id)?.name ?? '—';

  const filtered = requests.filter((r) => {
    if (!verticalFilter) return true;
    return employees[r.employeeId]?.verticalId === verticalFilter;
  });

  async function act(id: string, action: 'approve' | 'reject') {
    const ok = await confirm(
      action === 'approve'
        ? { title: 'Approve this leave request?' }
        : {
            title: 'Reject this leave request?',
            description: 'The employee will be notified of the rejection.',
            destructive: true,
          },
    );
    if (!ok) return;
    setActing(id);
    try {
      await apiFetch(`/leave-requests/${id}/${action}`, {
        method: 'PATCH',
        body: JSON.stringify({ approverComments: comments[id] || undefined }),
      });
      await load();
    } catch (err) {
      toast.error(
        err instanceof ApiError ? err.message : `Failed to ${action} request`,
      );
    } finally {
      setActing(null);
    }
  }

  return (
    <div>
      <h1>All Pending Approvals</h1>

      <div style={{ marginBottom: 16 }}>
        <select
          value={verticalFilter}
          onChange={(e) => setVerticalFilter(e.target.value)}
          style={{ padding: 6 }}
        >
          <option value="">All verticals</option>
          {verticals.map((v) => (
            <option key={v.id} value={v.id}>
              {v.name}
            </option>
          ))}
        </select>
      </div>

      {error && <p style={{ color: 'crimson' }}>{error}</p>}
      {loading ? (
        <p>Loading…</p>
      ) : filtered.length === 0 ? (
        <p>No pending requests.</p>
      ) : (
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ textAlign: 'left', borderBottom: '1px solid #ccc' }}>
              <th>Employee</th>
              <th>Vertical</th>
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
            {filtered.map((r) => {
              const emp = employees[r.employeeId];
              return (
                <tr key={r.id} style={{ borderBottom: '1px solid #eee' }}>
                  <td>{emp ? `${emp.firstName} ${emp.lastName}` : r.employeeId}</td>
                  <td>{verticalName(emp?.verticalId ?? null)}</td>
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
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}
