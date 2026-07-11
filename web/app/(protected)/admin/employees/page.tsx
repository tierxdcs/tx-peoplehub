'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { apiFetch, ApiError } from '../../../lib/api';
import { Employee, PaginatedResult, Vertical } from '../../../lib/types';
import { useConfirm } from '../../../components/ui/confirm';
import { useToast } from '../../../components/ui/toaster';
import { useAuth } from '../../../lib/auth-context';

export default function EmployeesListPage() {
  const confirm = useConfirm();
  const toast = useToast();
  const { user } = useAuth();
  const isSuperAdmin = user?.role === 'SUPER_ADMIN';
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [verticals, setVerticals] = useState<Vertical[]>([]);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [verticalFilter, setVerticalFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const limit = 20;

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [employeesRes, verticalsRes] = await Promise.all([
        apiFetch<PaginatedResult<Employee>>(
          `/employees?page=${page}&limit=${limit}`,
        ),
        apiFetch<Vertical[]>('/verticals'),
      ]);
      setEmployees(employeesRes.items);
      setTotal(employeesRes.total);
      setVerticals(verticalsRes);
    } catch {
      setError('Failed to load employees');
    } finally {
      setLoading(false);
    }
  }, [page]);

  useEffect(() => {
    load();
  }, [load]);

  async function handleDeactivate(e: Employee) {
    const ok = await confirm({
      title: `Deactivate ${e.firstName} ${e.lastName}?`,
      description:
        'They will lose login access. All their records are kept and this can be reversed.',
      confirmLabel: 'Deactivate',
      destructive: true,
    });
    if (!ok) return;
    try {
      await apiFetch(`/employees/${e.id}/deactivate`, { method: 'PATCH' });
      toast.success('Employee deactivated.');
      await load();
    } catch (err) {
      toast.error(
        err instanceof ApiError ? err.message : 'Failed to deactivate',
      );
    }
  }

  async function handleReactivate(e: Employee) {
    const ok = await confirm({
      title: `Activate ${e.firstName} ${e.lastName}?`,
      description:
        'This restores their login access with their existing role, vertical, and manager. It is not a re-hire — no onboarding needed.',
      confirmLabel: 'Activate',
    });
    if (!ok) return;
    try {
      await apiFetch(`/employees/${e.id}/reactivate`, { method: 'PATCH' });
      toast.success('Employee activated.');
      await load();
    } catch (err) {
      toast.error(
        err instanceof ApiError ? err.message : 'Failed to activate',
      );
    }
  }

  async function handleDelete(e: Employee) {
    const ok = await confirm({
      title: `Permanently delete ${e.firstName} ${e.lastName}?`,
      description:
        'This removes the account entirely and cannot be undone. It is refused if they still own any reports or business records — deactivate instead in that case. Use this only for mistaken or duplicate accounts.',
      confirmLabel: 'Delete permanently',
      destructive: true,
    });
    if (!ok) return;
    try {
      await apiFetch(`/employees/${e.id}`, { method: 'DELETE' });
      toast.success(`${e.firstName} ${e.lastName} deleted.`);
      await load();
    } catch (err) {
      // Surface the backend's specific blocker list (e.g. "still referenced by
      // 3 payslips, 1 owned customer …") rather than a generic failure.
      toast.error(
        err instanceof ApiError ? err.message : 'Failed to delete employee',
      );
    }
  }

  const verticalName = (id: string | null) =>
    verticals.find((v) => v.id === id)?.name ?? '—';

  const filtered = employees.filter((e) => {
    if (verticalFilter && e.verticalId !== verticalFilter) return false;
    if (statusFilter && e.status !== statusFilter) return false;
    if (search) {
      const haystack = `${e.firstName} ${e.lastName} ${e.email}`.toLowerCase();
      if (!haystack.includes(search.toLowerCase())) return false;
    }
    return true;
  });

  return (
    <div>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          marginBottom: 16,
        }}
      >
        <h1>Employees</h1>
        <Link href="/admin/employees/new">
          <button style={{ padding: '8px 16px' }}>Create Employee</button>
        </Link>
      </div>

      <div style={{ display: 'flex', gap: 12, marginBottom: 16 }}>
        <input
          placeholder="Search name or email"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ padding: 6 }}
        />
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
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          style={{ padding: 6 }}
        >
          <option value="">All statuses</option>
          <option value="ACTIVE">Active</option>
          <option value="INACTIVE">Inactive</option>
        </select>
      </div>

      {error && <p style={{ color: 'crimson' }}>{error}</p>}
      {loading ? (
        <p>Loading…</p>
      ) : (
        <>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ textAlign: 'left', borderBottom: '1px solid #ccc' }}>
                <th>Employee ID</th>
                <th>Name</th>
                <th>Email</th>
                <th>Vertical</th>
                <th>Role</th>
                <th>Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((e) => (
                <tr key={e.id} style={{ borderBottom: '1px solid #eee' }}>
                  <td>{e.employeeId}</td>
                  <td>
                    <Link href={`/admin/employees/${e.id}`}>
                      {e.firstName} {e.lastName}
                    </Link>
                    {e.isSalesHead && (
                      <span
                        style={{
                          marginLeft: 8,
                          fontSize: 11,
                          fontWeight: 600,
                          color: '#1d4ed8',
                          background: '#dbeafe',
                          borderRadius: 10,
                          padding: '1px 8px',
                        }}
                      >
                        Sales Head
                      </span>
                    )}
                  </td>
                  <td>{e.email}</td>
                  <td>{verticalName(e.verticalId)}</td>
                  <td>{e.role}</td>
                  <td>{e.status}</td>
                  <td>
                    <div style={{ display: 'flex', gap: 8 }}>
                      <Link href={`/admin/employees/${e.id}`}>
                        <button>Edit</button>
                      </Link>
                      {e.status === 'ACTIVE' ? (
                        <button onClick={() => handleDeactivate(e)}>
                          Deactivate
                        </button>
                      ) : (
                        <button onClick={() => handleReactivate(e)}>
                          Activate
                        </button>
                      )}
                      {isSuperAdmin && (
                        <button
                          onClick={() => handleDelete(e)}
                          style={{ color: 'crimson' }}
                        >
                          Delete
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          <div style={{ marginTop: 16, display: 'flex', gap: 8 }}>
            <button disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
              Prev
            </button>
            <span>
              Page {page} of {Math.max(1, Math.ceil(total / limit))}
            </span>
            <button
              disabled={page * limit >= total}
              onClick={() => setPage((p) => p + 1)}
            >
              Next
            </button>
          </div>
        </>
      )}
    </div>
  );
}
