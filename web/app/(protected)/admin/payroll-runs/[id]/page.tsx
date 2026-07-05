'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { apiFetch, ApiError } from '../../../../lib/api';
import { Employee, PayrollRun, Payslip } from '../../../../lib/types';

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

export default function PayrollRunDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [run, setRun] = useState<PayrollRun | null>(null);
  const [payslips, setPayslips] = useState<Payslip[]>([]);
  const [employeeNames, setEmployeeNames] = useState<Record<string, string>>(
    {},
  );
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [processing, setProcessing] = useState(false);
  const [processError, setProcessError] = useState<string | null>(null);
  const [locking, setLocking] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const runRes = await apiFetch<PayrollRun>(`/payroll-runs/${id}`);
      setRun(runRes);

      if (runRes.status === 'COMPLETED' || runRes.status === 'LOCKED') {
        const payslipsRes = await apiFetch<Payslip[]>(
          `/payroll-runs/${id}/payslips`,
        );
        setPayslips(payslipsRes);

        const ids = [...new Set(payslipsRes.map((p) => p.employeeId))];
        const resolved: Record<string, string> = {};
        await Promise.all(
          ids.map(async (empId) => {
            try {
              const emp = await apiFetch<Employee>(`/employees/${empId}`);
              resolved[empId] = `${emp.firstName} ${emp.lastName}`;
            } catch {
              resolved[empId] = empId;
            }
          }),
        );
        setEmployeeNames(resolved);
      }
    } catch {
      setError('Failed to load payroll run');
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  async function handleProcess() {
    setProcessing(true);
    setProcessError(null);
    try {
      await apiFetch(`/payroll-runs/${id}/process`, { method: 'POST' });
      await load();
    } catch (err) {
      if (err instanceof ApiError && /StatutoryConfig/i.test(err.message)) {
        // This is a deliberate safety check, not a bug — surface the
        // backend's exact missing-config list rather than a generic
        // failure, per the spec's explicit requirement.
        setProcessError(
          `Statutory configuration incomplete — cannot process payroll. ${err.message}`,
        );
      } else {
        setProcessError(
          err instanceof ApiError ? err.message : 'Failed to process run',
        );
      }
    } finally {
      setProcessing(false);
    }
  }

  async function handleLock() {
    if (
      !confirm(
        'Once locked, this run cannot be edited — corrections require a new adjustment in a future period. Continue?',
      )
    ) {
      return;
    }
    setLocking(true);
    try {
      await apiFetch(`/payroll-runs/${id}/lock`, { method: 'PATCH' });
      await load();
    } catch (err) {
      alert(err instanceof ApiError ? err.message : 'Failed to lock run');
    } finally {
      setLocking(false);
    }
  }

  if (loading) return <p>Loading…</p>;
  if (error || !run) return <p style={{ color: 'crimson' }}>{error}</p>;

  return (
    <div>
      <h1>
        Payroll Run — {MONTH_NAMES[run.month - 1]} {run.year}
      </h1>

      <dl>
        <dt>Status</dt>
        <dd>{run.status}</dd>
        <dt>Processed at</dt>
        <dd>{run.processedAt ? new Date(run.processedAt).toLocaleString() : '—'}</dd>
        <dt>Locked at</dt>
        <dd>{run.lockedAt ? new Date(run.lockedAt).toLocaleString() : '—'}</dd>
      </dl>

      {run.status === 'DRAFT' && (
        <div style={{ marginBottom: 24 }}>
          <button
            onClick={handleProcess}
            disabled={processing}
            style={{ padding: '10px 20px' }}
          >
            {processing ? 'Processing… (scanning all active employees)' : 'Process'}
          </button>
          {processError && (
            <p style={{ color: 'crimson', maxWidth: 600 }}>{processError}</p>
          )}
        </div>
      )}

      {run.status === 'PROCESSING' && (
        <p style={{ color: '#666' }}>Processing is in progress…</p>
      )}

      {(run.status === 'COMPLETED' || run.status === 'LOCKED') && (
        <>
          {run.status === 'COMPLETED' && (
            <div style={{ marginBottom: 16 }}>
              <button onClick={handleLock} disabled={locking}>
                {locking ? 'Locking…' : 'Lock Run'}
              </button>
            </div>
          )}
          {run.status === 'LOCKED' && (
            <p style={{ color: '#a00' }}>
              This run is locked and cannot be edited.
            </p>
          )}

          <h2>Payslips</h2>
          {payslips.length === 0 ? (
            <p>No payslips.</p>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ textAlign: 'left', borderBottom: '1px solid #ccc' }}>
                  <th>Employee</th>
                  <th>Gross</th>
                  <th>Net Pay</th>
                  <th>Status</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {payslips.map((p) => (
                  <tr key={p.id} style={{ borderBottom: '1px solid #eee' }}>
                    <td>{employeeNames[p.employeeId] ?? '…'}</td>
                    <td>{p.grossEarnings}</td>
                    <td>{p.netPay}</td>
                    <td>{p.status}</td>
                    <td>
                      <Link
                        href={`/admin/payroll-runs/${run.id}/payslips/${p.id}`}
                      >
                        View detail
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </>
      )}
    </div>
  );
}
