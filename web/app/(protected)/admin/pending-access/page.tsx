'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { apiFetch, ApiError } from '../../../lib/api';
import { useAuth } from '../../../lib/auth-context';
import { Employee, PaginatedResult, Vertical } from '../../../lib/types';

// MANAGER / EMPLOYEE are grantable by any admin; ADMIN is added only for a
// SUPER_ADMIN caller (mirrors the backend assertMayAssignRole rule — the API
// rejects an ADMIN grant from anyone else regardless of the UI).
const NON_PRIVILEGED_ROLES: Array<'MANAGER' | 'EMPLOYEE'> = [
  'MANAGER',
  'EMPLOYEE',
];

const fieldStyle: React.CSSProperties = {
  width: '100%',
  padding: 8,
  boxSizing: 'border-box',
};

export default function PendingAccessPage() {
  const [items, setItems] = useState<Employee[]>([]);
  const [verticals, setVerticals] = useState<Vertical[]>([]);
  const [candidateManagers, setCandidateManagers] = useState<Employee[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [grantTarget, setGrantTarget] = useState<Employee | null>(null);
  const [granted, setGranted] = useState<Employee | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [pendingRes, verticalsRes, employeesRes] = await Promise.all([
        apiFetch<PaginatedResult<Employee>>(
          '/employees/pending-access?page=1&limit=100',
        ),
        apiFetch<Vertical[]>('/verticals'),
        apiFetch<PaginatedResult<Employee>>('/employees?page=1&limit=100'),
      ]);
      setItems(pendingRes.items);
      setVerticals(verticalsRes);
      setCandidateManagers(
        employeesRes.items.filter(
          (e) =>
            e.status === 'ACTIVE' &&
            (e.role === 'MANAGER' || e.role === 'SUPER_ADMIN'),
        ),
      );
    } catch {
      setError('Failed to load pending access queue');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const verticalName = (id: string | null) =>
    verticals.find((v) => v.id === id)?.name ?? '—';

  return (
    <div>
      <h1>Pending Access</h1>

      {error && <p className="text-destructive">{error}</p>}
      {loading ? (
        <p>Loading…</p>
      ) : items.length === 0 ? (
        <p>No employees awaiting access.</p>
      ) : (
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ textAlign: 'left', borderBottom: '1px solid hsl(var(--border))' }}>
              <th>Employee ID</th>
              <th>Name</th>
              <th>Vertical</th>
              <th>Designation</th>
              <th>Date onboarded</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {items.map((e) => (
              <tr key={e.id} style={{ borderBottom: '1px solid hsl(var(--border))' }}>
                <td>{e.employeeId}</td>
                <td>
                  {e.firstName} {e.lastName}
                </td>
                <td>{verticalName(e.verticalId)}</td>
                <td>{e.designation ?? '—'}</td>
                <td>{new Date(e.createdAt).toLocaleDateString()}</td>
                <td>
                  <button onClick={() => setGrantTarget(e)}>
                    Grant Access
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {grantTarget && (
        <GrantAccessForm
          employee={grantTarget}
          verticals={verticals}
          candidateManagers={candidateManagers}
          onClose={() => setGrantTarget(null)}
          onGranted={(employee) => {
            setGrantTarget(null);
            setGranted(employee);
            load();
          }}
        />
      )}

      {granted && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.4)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
          onClick={() => setGranted(null)}
        >
          <div
            style={{ background: 'hsl(var(--card))', padding: 24, borderRadius: 6 }}
            onClick={(e) => e.stopPropagation()}
          >
            <h2>Access granted</h2>
            <p>
              {granted.firstName} {granted.lastName} can now log in using{' '}
              <strong>{granted.email}</strong>.
            </p>
            <button onClick={() => setGranted(null)}>Close</button>
          </div>
        </div>
      )}
    </div>
  );
}

function GrantAccessForm({
  employee,
  verticals,
  candidateManagers,
  onClose,
  onGranted,
}: {
  employee: Employee;
  verticals: Vertical[];
  candidateManagers: Employee[];
  onClose: () => void;
  onGranted: (employee: Employee) => void;
}) {
  const { user } = useAuth();
  const callerIsSuperAdmin = user?.role === 'SUPER_ADMIN';
  const assignableRoles: Array<'ADMIN' | 'MANAGER' | 'EMPLOYEE'> =
    callerIsSuperAdmin
      ? ['ADMIN', ...NON_PRIVILEGED_ROLES]
      : [...NON_PRIVILEGED_ROLES];
  const [role, setRole] = useState<'ADMIN' | 'MANAGER' | 'EMPLOYEE'>(
    'EMPLOYEE',
  );
  const [verticalId, setVerticalId] = useState(employee.verticalId ?? '');
  const [managerId, setManagerId] = useState('');
  const [managerSearch, setManagerSearch] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const managerOptions = useMemo(() => {
    return candidateManagers.filter((m) => {
      const haystack = `${m.firstName} ${m.lastName} ${m.email}`.toLowerCase();
      return haystack.includes(managerSearch.toLowerCase());
    });
  }, [candidateManagers, managerSearch]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (!verticalId) {
      setError('Vertical is required');
      return;
    }
    if (!managerId) {
      setError('Reporting manager is required');
      return;
    }

    setSubmitting(true);
    try {
      const granted = await apiFetch<Employee>(
        `/employees/${employee.id}/grant-access`,
        {
          method: 'PATCH',
          body: JSON.stringify({
            role,
            verticalId,
            reportingManagerId: managerId,
            password,
          }),
        },
      );
      onGranted(granted);
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : 'Failed to grant access',
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.4)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
      onClick={onClose}
    >
      <form
        onSubmit={handleSubmit}
        style={{
          background: 'hsl(var(--card))',
          padding: 24,
          borderRadius: 6,
          width: 400,
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <h2>
          Grant access — {employee.firstName} {employee.lastName}
        </h2>

        <div style={{ marginBottom: 12 }}>
          <label style={{ display: 'block', marginBottom: 4 }}>Role</label>
          <select
            value={role}
            onChange={(e) =>
              setRole(e.target.value as 'ADMIN' | 'MANAGER' | 'EMPLOYEE')
            }
            style={fieldStyle}
          >
            {assignableRoles.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
        </div>

        <div style={{ marginBottom: 12 }}>
          <label style={{ display: 'block', marginBottom: 4 }}>
            Vertical
          </label>
          <select
            value={verticalId}
            onChange={(e) => setVerticalId(e.target.value)}
            required
            style={fieldStyle}
          >
            <option value="">Select a vertical…</option>
            {verticals.map((v) => (
              <option key={v.id} value={v.id}>
                {v.name}
              </option>
            ))}
          </select>
        </div>

        <div style={{ marginBottom: 12 }}>
          <label style={{ display: 'block', marginBottom: 4 }}>
            Reporting manager
          </label>
          <input
            placeholder="Filter by name or email"
            value={managerSearch}
            onChange={(e) => setManagerSearch(e.target.value)}
            style={{ ...fieldStyle, marginBottom: 6 }}
          />
          <select
            value={managerId}
            onChange={(e) => setManagerId(e.target.value)}
            required
            style={fieldStyle}
          >
            <option value="">Select a manager…</option>
            {managerOptions.map((m) => (
              <option key={m.id} value={m.id}>
                {m.firstName} {m.lastName} ({m.employeeId}, {m.role})
              </option>
            ))}
          </select>
        </div>

        <div style={{ marginBottom: 12 }}>
          <label style={{ display: 'block', marginBottom: 4 }}>
            Initial password
          </label>
          <input
            type="text"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={8}
            style={fieldStyle}
          />
        </div>

        {error && <p className="text-destructive">{error}</p>}

        <div style={{ display: 'flex', gap: 8 }}>
          <button type="submit" disabled={submitting} style={{ padding: 8 }}>
            {submitting ? 'Granting…' : 'Grant Access'}
          </button>
          <button type="button" onClick={onClose} style={{ padding: 8 }}>
            Cancel
          </button>
        </div>
      </form>
    </div>
  );
}
