'use client';

import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '../../../lib/auth-context';
import { apiFetch } from '../../../lib/api';
import {
  AccessStatus,
  EmployeeRoster,
  EmployeeRosterAdmin,
  PaginatedResult,
  Vertical,
} from '../../../lib/types';
import { SensitiveDetailPanel } from './_components/sensitive-detail-panel';

export default function RosterPage() {
  const { user } = useAuth();
  const isAdmin = user?.role === 'ADMIN' || user?.role === 'SUPER_ADMIN';

  const [items, setItems] = useState<(EmployeeRoster | EmployeeRosterAdmin)[]>(
    [],
  );
  const [verticals, setVerticals] = useState<Vertical[]>([]);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [verticalFilter, setVerticalFilter] = useState('');
  const [accessStatusFilter, setAccessStatusFilter] = useState<
    AccessStatus | ''
  >('');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [detailTarget, setDetailTarget] = useState<{
    id: string;
    name: string;
  } | null>(null);
  const limit = 20;

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [rosterRes, verticalsRes] = await Promise.all([
        apiFetch<PaginatedResult<EmployeeRoster | EmployeeRosterAdmin>>(
          `/employees/roster?page=${page}&limit=${limit}`,
        ),
        apiFetch<Vertical[]>('/verticals'),
      ]);
      setItems(rosterRes.items);
      setTotal(rosterRes.total);
      setVerticals(verticalsRes);
    } catch {
      setError('Failed to load roster');
    } finally {
      setLoading(false);
    }
  }, [page]);

  useEffect(() => {
    load();
  }, [load]);

  const verticalName = (id: string | null) =>
    verticals.find((v) => v.id === id)?.name ?? '—';

  const filtered = items.filter((e) => {
    if (verticalFilter && e.verticalId !== verticalFilter) return false;
    if (accessStatusFilter && e.accessStatus !== accessStatusFilter)
      return false;
    if (search) {
      const haystack = `${e.firstName} ${e.lastName}`.toLowerCase();
      if (!haystack.includes(search.toLowerCase())) return false;
    }
    return true;
  });

  return (
    <div>
      <h1>Roster</h1>

      <div style={{ display: 'flex', gap: 12, marginBottom: 16 }}>
        <input
          placeholder="Search name"
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
          value={accessStatusFilter}
          onChange={(e) =>
            setAccessStatusFilter(e.target.value as AccessStatus | '')
          }
          style={{ padding: 6 }}
        >
          <option value="">All access statuses</option>
          <option value="PENDING_ACCESS">Pending Access</option>
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
                <th>Vertical</th>
                <th>Designation</th>
                <th>Employment Type</th>
                <th>Work Location</th>
                <th>Access Status</th>
                {isAdmin && <th>Sensitive Info</th>}
                {isAdmin && <th></th>}
              </tr>
            </thead>
            <tbody>
              {filtered.map((e) => (
                <tr key={e.id} style={{ borderBottom: '1px solid #eee' }}>
                  <td>{e.employeeId}</td>
                  <td>
                    {e.firstName} {e.lastName}
                  </td>
                  <td>{verticalName(e.verticalId)}</td>
                  <td>{e.designation ?? '—'}</td>
                  <td>{e.employmentType ?? '—'}</td>
                  <td>{e.workLocation ?? '—'}</td>
                  <td>{e.accessStatus}</td>
                  {isAdmin && (
                    <td>
                      {(e as EmployeeRosterAdmin).hasCompensationOnFile &&
                      (e as EmployeeRosterAdmin).hasStatutoryInfoOnFile &&
                      (e as EmployeeRosterAdmin).hasBankDetailsOnFile
                        ? '✓ Complete'
                        : '⚠ Incomplete'}
                    </td>
                  )}
                  {isAdmin && (
                    <td>
                      <button
                        onClick={() =>
                          setDetailTarget({
                            id: e.id,
                            name: `${e.firstName} ${e.lastName}`,
                          })
                        }
                      >
                        View sensitive details
                      </button>
                    </td>
                  )}
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

      {detailTarget && (
        <SensitiveDetailPanel
          employeeId={detailTarget.id}
          employeeName={detailTarget.name}
          onClose={() => setDetailTarget(null)}
        />
      )}
    </div>
  );
}
