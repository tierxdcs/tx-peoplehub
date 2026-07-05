'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { apiFetch } from '../../../lib/api';
import { Employee, PaginatedResult, Vertical } from '../../../lib/types';

export default function EmployeesListPage() {
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

  async function handleDeactivate(id: string) {
    if (!confirm('Deactivate this employee? They will lose login access.')) {
      return;
    }
    await apiFetch(`/employees/${id}/deactivate`, { method: 'PATCH' });
    await load();
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
                  </td>
                  <td>{e.email}</td>
                  <td>{verticalName(e.verticalId)}</td>
                  <td>{e.role}</td>
                  <td>{e.status}</td>
                  <td>
                    {e.status === 'ACTIVE' && (
                      <button onClick={() => handleDeactivate(e.id)}>
                        Deactivate
                      </button>
                    )}
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
