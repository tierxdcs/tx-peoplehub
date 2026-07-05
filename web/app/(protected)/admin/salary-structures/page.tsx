'use client';

import { useEffect, useMemo, useState } from 'react';
import { apiFetch, ApiError } from '../../../lib/api';
import {
  Employee,
  PaginatedResult,
  SalaryStructure,
} from '../../../lib/types';

const fieldStyle: React.CSSProperties = {
  width: '100%',
  padding: 8,
  boxSizing: 'border-box',
};

export default function SalaryStructuresPage() {
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [search, setSearch] = useState('');
  const [employeeId, setEmployeeId] = useState('');
  const [current, setCurrent] = useState<SalaryStructure | null>(null);
  const [history, setHistory] = useState<SalaryStructure[]>([]);
  const [loadingRecord, setLoadingRecord] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);

  useEffect(() => {
    apiFetch<PaginatedResult<Employee>>('/employees?page=1&limit=100').then(
      (res) => setEmployees(res.items),
    );
  }, []);

  const options = useMemo(() => {
    if (!search) return employees;
    const q = search.toLowerCase();
    return employees.filter((e) =>
      `${e.firstName} ${e.lastName} ${e.employeeId} ${e.email}`
        .toLowerCase()
        .includes(q),
    );
  }, [employees, search]);

  async function loadFor(id: string) {
    if (!id) {
      setCurrent(null);
      setHistory([]);
      return;
    }
    setLoadingRecord(true);
    setError(null);
    try {
      const [currentRes, historyRes] = await Promise.all([
        apiFetch<SalaryStructure | null>(`/salary-structures/${id}/current`),
        apiFetch<SalaryStructure[]>(`/salary-structures/${id}/history`),
      ]);
      setCurrent(currentRes);
      setHistory(historyRes);
    } catch {
      setError('Failed to load salary structure');
    } finally {
      setLoadingRecord(false);
    }
  }

  useEffect(() => {
    loadFor(employeeId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [employeeId]);

  const selectedEmployee = employees.find((e) => e.id === employeeId);

  return (
    <div>
      <h1>Salary Structures</h1>

      <div style={{ display: 'flex', gap: 12, marginBottom: 16 }}>
        <div>
          <label style={{ display: 'block', marginBottom: 4 }}>
            Search employee
          </label>
          <input
            placeholder="Name, ID, or email"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{ padding: 6, width: 220 }}
          />
        </div>
        <div>
          <label style={{ display: 'block', marginBottom: 4 }}>Employee</label>
          <select
            value={employeeId}
            onChange={(e) => setEmployeeId(e.target.value)}
            style={{ padding: 6, width: 220 }}
          >
            <option value="">Select an employee…</option>
            {options.map((e) => (
              <option key={e.id} value={e.id}>
                {e.firstName} {e.lastName} ({e.employeeId})
              </option>
            ))}
          </select>
        </div>
      </div>

      {error && <p style={{ color: 'crimson' }}>{error}</p>}

      {employeeId && (
        <>
          {loadingRecord ? (
            <p>Loading…</p>
          ) : (
            <>
              <div
                style={{
                  border: '1px solid #ccc',
                  borderRadius: 6,
                  padding: 16,
                  maxWidth: 480,
                  marginBottom: 24,
                }}
              >
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    marginBottom: 12,
                  }}
                >
                  <h2 style={{ margin: 0 }}>Current Structure</h2>
                  <button onClick={() => setShowForm(true)}>
                    Update Structure
                  </button>
                </div>
                {current ? (
                  <dl>
                    <dt>Effective from</dt>
                    <dd>{current.effectiveFrom.slice(0, 10)}</dd>
                    <dt>Basic</dt>
                    <dd>{current.basic}</dd>
                    <dt>HRA</dt>
                    <dd>{current.hra}</dd>
                    <dt>Special allowance</dt>
                    <dd>{current.specialAllowance}</dd>
                    <dt>Other allowances</dt>
                    <dd>{current.otherAllowances ?? '—'}</dd>
                    <dt>Annual CTC</dt>
                    <dd>{current.ctcAnnual}</dd>
                  </dl>
                ) : (
                  <p style={{ color: '#666' }}>
                    No salary structure on file for this employee yet.
                  </p>
                )}
              </div>

              <h2>History</h2>
              {history.length === 0 ? (
                <p>No history yet.</p>
              ) : (
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr
                      style={{
                        textAlign: 'left',
                        borderBottom: '1px solid #ccc',
                      }}
                    >
                      <th>Effective From</th>
                      <th>Basic</th>
                      <th>HRA</th>
                      <th>Special Allowance</th>
                      <th>Other Allowances</th>
                      <th>Annual CTC</th>
                    </tr>
                  </thead>
                  <tbody>
                    {history.map((h) => (
                      <tr key={h.id} style={{ borderBottom: '1px solid #eee' }}>
                        <td>{h.effectiveFrom.slice(0, 10)}</td>
                        <td>{h.basic}</td>
                        <td>{h.hra}</td>
                        <td>{h.specialAllowance}</td>
                        <td>{h.otherAllowances ?? '—'}</td>
                        <td>{h.ctcAnnual}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </>
          )}
        </>
      )}

      {showForm && selectedEmployee && (
        <UpdateStructureForm
          employeeName={`${selectedEmployee.firstName} ${selectedEmployee.lastName}`}
          employeeId={employeeId}
          onClose={() => setShowForm(false)}
          onSaved={() => {
            setShowForm(false);
            loadFor(employeeId);
          }}
        />
      )}
    </div>
  );
}

function UpdateStructureForm({
  employeeName,
  employeeId,
  onClose,
  onSaved,
}: {
  employeeName: string;
  employeeId: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [effectiveFrom, setEffectiveFrom] = useState('');
  const [basic, setBasic] = useState('');
  const [hra, setHra] = useState('');
  const [specialAllowance, setSpecialAllowance] = useState('');
  const [otherAllowances, setOtherAllowances] = useState('');
  const [ctcAnnual, setCtcAnnual] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (!effectiveFrom || !basic || !hra || !ctcAnnual) {
      setError('Effective date, basic, HRA, and annual CTC are required');
      return;
    }

    setSubmitting(true);
    try {
      await apiFetch('/salary-structures', {
        method: 'POST',
        body: JSON.stringify({
          employeeId,
          effectiveFrom,
          basic: Number(basic),
          hra: Number(hra),
          specialAllowance: specialAllowance ? Number(specialAllowance) : 0,
          otherAllowances: otherAllowances ? Number(otherAllowances) : undefined,
          ctcAnnual: Number(ctcAnnual),
        }),
      });
      onSaved();
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : 'Failed to save structure',
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
        style={{ background: '#fff', padding: 24, borderRadius: 6, width: 400 }}
        onClick={(e) => e.stopPropagation()}
      >
        <h2>Update Structure — {employeeName}</h2>
        <p style={{ color: '#666', fontSize: 13 }}>
          This creates a new effective-dated entry — it does not overwrite
          the existing history.
        </p>

        <div style={{ marginBottom: 12 }}>
          <label style={{ display: 'block', marginBottom: 4 }}>
            Effective from
          </label>
          <input
            type="date"
            value={effectiveFrom}
            onChange={(e) => setEffectiveFrom(e.target.value)}
            style={fieldStyle}
          />
        </div>

        <div style={{ marginBottom: 12 }}>
          <label style={{ display: 'block', marginBottom: 4 }}>Basic</label>
          <input
            type="number"
            min={0}
            value={basic}
            onChange={(e) => setBasic(e.target.value)}
            style={fieldStyle}
          />
        </div>

        <div style={{ marginBottom: 12 }}>
          <label style={{ display: 'block', marginBottom: 4 }}>HRA</label>
          <input
            type="number"
            min={0}
            value={hra}
            onChange={(e) => setHra(e.target.value)}
            style={fieldStyle}
          />
        </div>

        <div style={{ marginBottom: 12 }}>
          <label style={{ display: 'block', marginBottom: 4 }}>
            Special allowance
          </label>
          <input
            type="number"
            min={0}
            value={specialAllowance}
            onChange={(e) => setSpecialAllowance(e.target.value)}
            style={fieldStyle}
          />
        </div>

        <div style={{ marginBottom: 12 }}>
          <label style={{ display: 'block', marginBottom: 4 }}>
            Other allowances
          </label>
          <input
            type="number"
            min={0}
            value={otherAllowances}
            onChange={(e) => setOtherAllowances(e.target.value)}
            style={fieldStyle}
          />
        </div>

        <div style={{ marginBottom: 12 }}>
          <label style={{ display: 'block', marginBottom: 4 }}>
            Annual CTC
          </label>
          <input
            type="number"
            min={0}
            value={ctcAnnual}
            onChange={(e) => setCtcAnnual(e.target.value)}
            style={fieldStyle}
          />
        </div>

        {error && <p style={{ color: 'crimson' }}>{error}</p>}

        <div style={{ display: 'flex', gap: 8 }}>
          <button type="submit" disabled={submitting} style={{ padding: 8 }}>
            {submitting ? 'Saving…' : 'Save'}
          </button>
          <button type="button" onClick={onClose} style={{ padding: 8 }}>
            Cancel
          </button>
        </div>
      </form>
    </div>
  );
}
