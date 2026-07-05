'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { apiFetch, ApiError } from '../../../lib/api';
import { PayrollRun } from '../../../lib/types';

const MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

const fieldStyle: React.CSSProperties = {
  width: '100%',
  padding: 8,
  boxSizing: 'border-box',
};

export default function PayrollRunsPage() {
  const [runs, setRuns] = useState<PayrollRun[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const router = useRouter();

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiFetch<PayrollRun[]>('/payroll-runs');
      setRuns(res);
    } catch {
      setError('Failed to load payroll runs');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          marginBottom: 16,
        }}
      >
        <h1>Payroll Runs</h1>
        <button style={{ padding: '8px 16px' }} onClick={() => setShowForm(true)}>
          New Payroll Run
        </button>
      </div>

      {error && <p style={{ color: 'crimson' }}>{error}</p>}
      {loading ? (
        <p>Loading…</p>
      ) : runs.length === 0 ? (
        <p>No payroll runs yet.</p>
      ) : (
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ textAlign: 'left', borderBottom: '1px solid #ccc' }}>
              <th>Period</th>
              <th>Status</th>
              <th>Processed</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {runs.map((r) => (
              <tr key={r.id} style={{ borderBottom: '1px solid #eee' }}>
                <td>
                  {MONTH_NAMES[r.month - 1]} {r.year}
                </td>
                <td>{r.status}</td>
                <td>
                  {r.processedAt
                    ? new Date(r.processedAt).toLocaleString()
                    : '—'}
                </td>
                <td>
                  <Link href={`/admin/payroll-runs/${r.id}`}>View</Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {showForm && (
        <NewRunForm
          onClose={() => setShowForm(false)}
          onCreated={(run) => {
            setShowForm(false);
            router.push(`/admin/payroll-runs/${run.id}`);
          }}
        />
      )}
    </div>
  );
}

function NewRunForm({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (run: PayrollRun) => void;
}) {
  const now = new Date();
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [year, setYear] = useState(now.getFullYear());
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const run = await apiFetch<PayrollRun>('/payroll-runs', {
        method: 'POST',
        body: JSON.stringify({ month, year }),
      });
      onCreated(run);
    } catch (err) {
      // Surface the backend's specific duplicate-month/year message verbatim.
      setError(err instanceof ApiError ? err.message : 'Failed to create run');
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
        style={{ background: '#fff', padding: 24, borderRadius: 6, width: 320 }}
        onClick={(e) => e.stopPropagation()}
      >
        <h2>New Payroll Run</h2>

        <div style={{ marginBottom: 12 }}>
          <label style={{ display: 'block', marginBottom: 4 }}>Month</label>
          <select
            value={month}
            onChange={(e) => setMonth(Number(e.target.value))}
            style={fieldStyle}
          >
            {MONTH_NAMES.map((name, i) => (
              <option key={name} value={i + 1}>
                {name}
              </option>
            ))}
          </select>
        </div>

        <div style={{ marginBottom: 12 }}>
          <label style={{ display: 'block', marginBottom: 4 }}>Year</label>
          <input
            type="number"
            value={year}
            onChange={(e) => setYear(Number(e.target.value))}
            style={fieldStyle}
          />
        </div>

        {error && <p style={{ color: 'crimson' }}>{error}</p>}

        <div style={{ display: 'flex', gap: 8 }}>
          <button type="submit" disabled={submitting} style={{ padding: 8 }}>
            {submitting ? 'Creating…' : 'Create'}
          </button>
          <button type="button" onClick={onClose} style={{ padding: 8 }}>
            Cancel
          </button>
        </div>
      </form>
    </div>
  );
}
